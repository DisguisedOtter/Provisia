# Writing modules: payment gateways, registrars, provisioners

Provisia talks to the outside world through three kinds of plugins, all defined by `@provisia/module-sdk`
(`packages/module-sdk`). This guide is for module authors. The contract itself is in `docs/ARCHITECTURE.md`
section 4 and `packages/module-sdk/src/types.ts` (interfaces) and `dto.ts` (data shapes); when in doubt the
TypeScript types win over this document.

| Kind | Interface | Examples | Lives in |
|---|---|---|---|
| Payment gateway | `PaymentGateway` | Stripe, Mollie, PayPal, BTCPay | `packages/gateway-<name>` |
| Domain registrar | `Registrar` | Skrime | `packages/registrar-<name>` |
| Provisioner | `Provisioner` | cPanel, Plesk, DirectAdmin, Proxmox, Skrime webspace / KVM reselling | `packages/provisioner-<name>` |

## 1. How modules are run

- A module is a plain object created with `defineGateway()`, `defineRegistrar()` or `defineProvisioner()`.
  These helpers only add typing: `ctx.config` is inferred from your `configSchema`.
- Modules are registered **statically** in `apps/api/src/modules/registry.ts` (`loadModules()`), held in a
  `ModuleRegistry` and looked up by `kind` + `id`. There is no dynamic loading from disk; a module is a workspace
  package that gets bundled into the api and worker images.
- **Everything runs in the worker** (BullMQ job, retried 3x with backoff, logged to `jobs_log`), except
  `PaymentGateway.handleWebhook` / `handleReturn` and `Registrar.checkAvailability`, which run inline in the API
  because they answer an HTTP request. Keep those fast and idempotent.
- The admin configures a module instance in the UI. Config is validated with your `configSchema`, secrets are
  stored encrypted (`APP_KEY`, AES-256-GCM) and decrypted into `ctx.config` right before a call. Provisioner
  calls additionally get the decrypted **server** credentials in `ctx.credentials`.
- Modules never touch the database. They receive DTOs and return results; the core persists them
  (`moduleData` → `services.module_data` / `domains.module_data`, transactions, etc.).

### The context

```ts
interface ModuleContext<TConfig> {
  config: TConfig;                       // parsed with your configSchema, secrets decrypted
  credentials: Record<string, unknown>;  // decrypted server credentials (provisioners), {} otherwise
  logger: ModuleLogger;                  // pino child; use objects: logger.info({ domain }, 'registered')
  fetch: FetchWithTimeout;               // fetch(url, { timeoutMs: 15_000, ... }) — rejects on timeout (default 30 s)
  appUrl: string;                        // public API base, e.g. for webhook URLs: `${ctx.appUrl}/api/v1/public/webhooks/<id>`
  webUrl: string;                        // public web base, e.g. for return URLs after checkout
}
```

Use `ctx.fetch`, not the global `fetch`: it applies a timeout and is what tests mock. Never log `ctx.config`
or `ctx.credentials` wholesale.

## 2. Package skeleton

```
packages/gateway-acme/
├── package.json          name @provisia/gateway-acme, "exports": { ".": "./src/index.ts" }, deps: @provisia/module-sdk, zod
├── tsconfig.json         { "extends": "../../tsconfig.base.json", "include": ["src"] }
├── README.md             what the module supports, how to get sandbox credentials, how to run the tests
└── src/
    ├── index.ts          export default defineGateway({...})
    ├── client.ts         thin HTTP client around ctx.fetch (auth headers, error mapping)
    └── index.test.ts     vitest + msw/nock, recorded responses
```

`package.json`:

```json
{
  "name": "@provisia/gateway-acme",
  "version": "0.1.0",
  "private": true,
  "license": "AGPL-3.0-only",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@provisia/module-sdk": "workspace:*", "zod": "4.6.7" },
  "devDependencies": { "@types/node": "22.20.5", "msw": "2.x.y", "typescript": "5.9.3", "vitest": "5.0.5" }
}
```

Pin exact versions (match the ones already used in the repo). Workspace packages ship TypeScript source; no build step.

Wire it up:

1. `pnpm add @provisia/gateway-acme@workspace:* --filter @provisia/api --filter @provisia/worker`
2. In `apps/api/src/modules/registry.ts`: `import acme from '@provisia/gateway-acme';` and add `acme` to the
   `gateways` array (one line each). The worker uses the same `loadModules()`.
3. `pnpm typecheck && pnpm --filter @provisia/gateway-acme test`.

Config schema tips: mark secrets with `.describe('secret')` or a `secret` suffix in the key name (`apiKey`,
`webhookSecret`) so the admin UI renders a password field and the core encrypts them; add `.default()` for
optional knobs (`testMode: z.boolean().default(false)`); keep the schema flat.

## 3. Payment gateway

Required: `capabilities`, `createPayment`, `handleWebhook`. Optional: `refund`, `testCredentials`,
`getPaymentStatus`, `createSetup` / `chargeSavedMethod` / `removeSavedMethod` (saved methods, off-session
recurring), `handleReturn` (gateways that need a server-side capture when the browser returns).

```ts
// packages/gateway-acme/src/index.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { defineGateway } from '@provisia/module-sdk';
import { z } from 'zod';

export default defineGateway({
  id: 'acme',
  name: 'Acme Pay',
  version: '0.1.0',
  configSchema: z.object({
    apiKey: z.string().min(1).describe('secret'),
    webhookSecret: z.string().min(1).describe('secret'),
    testMode: z.boolean().default(false),
  }),
  capabilities: { refunds: true, savedMethods: false, recurring: false },

  async testCredentials(ctx) {
    const res = await ctx.fetch('https://api.acme.example/v1/me', {
      headers: { authorization: `Bearer ${ctx.config.apiKey}` },
      timeoutMs: 10_000,
    });
    return res.ok ? { ok: true } : { ok: false, message: `Acme responded ${res.status}` };
  },

  async createPayment(ctx, invoice) {
    // Amounts are integer minor units; Acme wants the same, other providers want "12.34" strings.
    const res = await ctx.fetch('https://api.acme.example/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: invoice.total,
        currency: invoice.currency,
        description: `Invoice ${invoice.number}`,
        metadata: { invoiceId: invoice.id },
        redirectUrl: `${ctx.webUrl}/portal/invoices/${invoice.id}`,
        webhookUrl: `${ctx.appUrl}/api/v1/public/webhooks/acme`,
      }),
    });
    if (!res.ok) throw new Error(`acme createPayment failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; checkoutUrl: string };
    return { txnId: data.id, redirectUrl: data.checkoutUrl };
  },

  /** Must be idempotent: the core also dedupes on (gateway, txnId), but verify the signature yourself. */
  async handleWebhook(ctx, req) {
    const sig = String(req.headers['x-acme-signature'] ?? '');
    const expected = createHmac('sha256', ctx.config.webhookSecret).update(req.rawBody).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new Error('invalid webhook signature'); // -> 400, provider retries
    }
    const event = req.body as { id: string; type: string; payment: { id: string; amount: number; currency: string; fee: number; metadata: { invoiceId: string } } };
    switch (event.type) {
      case 'payment.paid':
        return {
          kind: 'payment',
          txnId: event.payment.id,
          invoiceId: event.payment.metadata.invoiceId,
          amount: { amount: event.payment.amount, currency: event.payment.currency },
          fee: { amount: event.payment.fee, currency: event.payment.currency },
          eventId: event.id,
        };
      case 'payment.failed':
        return { kind: 'failed', txnId: event.payment.id, invoiceId: event.payment.metadata.invoiceId, reason: 'declined', eventId: event.id };
      default:
        return { kind: 'ignored', reason: event.type, eventId: event.id };
    }
  },

  async refund(ctx, txn, amount) {
    const res = await ctx.fetch(`https://api.acme.example/v1/payments/${txn.gatewayTxnId}/refunds`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amount.amount, currency: amount.currency }),
    });
    if (!res.ok) throw new Error(`acme refund failed: ${res.status}`);
    const data = (await res.json()) as { id: string; status: 'succeeded' | 'pending' };
    return { refundTxnId: data.id, amount, status: data.status === 'succeeded' ? 'completed' : 'pending' };
  },
});
```

Rules:

- `handleWebhook` gets the **raw body** (`req.rawBody`) for HMAC verification; `req.body` is the parsed JSON.
  Throw on an invalid signature. Return `{ kind: 'ignored' }` for event types you do not handle; never throw for
  them (the provider would keep retrying).
- `WebhookResult.txnId` must be stable per payment; the core enforces uniqueness on (gateway id, txnId) so
  a redelivered event is a no-op.
- Overpayments and currency mismatches are handled by the core; report what the provider says.
- `redirectUrl` (hosted checkout) **or** `clientSecret` (embedded element, e.g. Stripe Elements) from
  `createPayment`. For embedded flows the web app needs a matching component; coordinate with the portal UI.
- Return `status: 'pending'` from `refund()` when the provider confirms asynchronously; the webhook
  (`kind: 'refund'`) completes it.

## 4. Registrar

Required: `checkAvailability`, `register`, `transfer`, `renew`, `getInfo`, `setNameservers`, `getEppCode`.
Optional: `setContacts`, `setLock`, `getTldPricing`.

```ts
// packages/registrar-acme/src/index.ts
import { defineRegistrar } from '@provisia/module-sdk';
import { z } from 'zod';

const BASE = 'https://api.acme-registrar.example/v2';

export default defineRegistrar({
  id: 'acme-registrar',
  name: 'Acme Registrar',
  version: '0.1.0',
  configSchema: z.object({
    apiToken: z.string().min(1).describe('secret'),
    sandbox: z.boolean().default(false),
    defaultNameservers: z.array(z.string()).default(['ns1.example.net', 'ns2.example.net']),
  }),

  async checkAvailability(ctx, domains) {
    // Runs inline in the API (order form). Keep it fast: one batched request, short timeout.
    const res = await api(ctx, 'POST', '/domains/check', { domains });
    return (res as { domain: string; available: boolean; premium?: boolean; price?: number }[]).map((d) => ({
      domain: d.domain,
      available: d.available,
      premium: d.premium,
      price: d.price != null ? { amount: d.price, currency: 'EUR' } : undefined,
    }));
  },

  async register(ctx, req) {
    const r = (await api(ctx, 'POST', '/domains', {
      domain: req.domain,
      years: req.years,
      nameservers: req.nameservers.length ? req.nameservers : ctx.config.defaultNameservers,
      contacts: req.contacts,         // DomainContacts: registrant/admin/tech/billing
      whoisPrivacy: req.idProtection ?? false,
      ...req.additionalFields,        // TLD specifics (e.g. .nl legal form) collected by the order form
    })) as { id: string; status: string; expiresAt?: string };
    return {
      status: r.status === 'active' ? 'completed' : 'pending',
      expiryDate: r.expiresAt,
      moduleData: { acmeDomainId: r.id },   // persisted to domains.module_data, back in domain.moduleData later
    };
  },

  async transfer(ctx, req) {
    const r = (await api(ctx, 'POST', '/transfers', { domain: req.domain, authCode: req.eppCode, years: req.years, contacts: req.contacts })) as { id: string };
    return { status: 'pending', moduleData: { acmeTransferId: r.id } };
  },

  async renew(ctx, domain, years) {
    const r = (await api(ctx, 'POST', `/domains/${domain.name}/renew`, { years })) as { expiresAt: string };
    return { status: 'completed', expiryDate: r.expiresAt };
  },

  async getInfo(ctx, domain) {
    const r = (await api(ctx, 'GET', `/domains/${domain.name}`)) as { status: string; expiresAt: string | null; nameservers: string[]; locked: boolean; privacy: boolean };
    return {
      status: r.status === 'active' ? 'active' : r.status === 'expired' ? 'expired' : 'unknown',
      expiryDate: r.expiresAt,
      nameservers: r.nameservers,
      locked: r.locked,
      idProtection: r.privacy,
    };
  },

  async setNameservers(ctx, domain, ns) {
    await api(ctx, 'PUT', `/domains/${domain.name}/nameservers`, { nameservers: ns });
  },

  async getEppCode(ctx, domain) {
    const r = (await api(ctx, 'GET', `/domains/${domain.name}/authcode`)) as { authCode: string };
    return r.authCode;
  },

  async setLock(ctx, domain, locked) {
    await api(ctx, 'PUT', `/domains/${domain.name}/lock`, { locked });
  },

  async getTldPricing(ctx) {
    const r = (await api(ctx, 'GET', '/pricing')) as { tld: string; register: number; renew: number; transfer: number; minYears: number }[];
    return r.map((p) => ({ ...p, currency: 'EUR' }));  // minor units per year
  },
});

async function api(ctx: { config: { apiToken: string; sandbox: boolean }; fetch: typeof fetch }, method: string, path: string, body?: unknown) {
  const base = ctx.config.sandbox ? BASE.replace('api.', 'sandbox-api.') : BASE;
  const res = await ctx.fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${ctx.config.apiToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`acme-registrar ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}
```

Rules:

- Domain operations other than `checkAvailability` run in the worker and may be retried: make `register` /
  `transfer` safe to call twice (check `getInfo` first, or rely on the registrar rejecting duplicates and map that
  to `status: 'completed'`).
- Return `status: 'pending'` for asynchronous registries; the domains sync job polls `getInfo` until the status
  settles and then activates the domain.
- Prices are minor units per year. Provide `getTldPricing` when the registrar exposes it; it feeds the admin
  "import TLD prices" action.
- `DomainDTO.moduleData` carries whatever you returned in `moduleData` earlier; use it for provider ids.

## 5. Provisioner

Required: `create`, `suspend`, `unsuspend`, `terminate`, `testConnection`. Optional: `changePackage`,
`changePassword`, `getUsage`, `loginUrl`, `listRemoteOptions` (populate package/plan dropdowns in the product
form), `power` (VPS start/stop/reboot), `extras` (module specific actions such as console URL, rDNS, firewall,
backups or reinstall: `{ id, name, audience: 'staff' | 'client', paramsSchema?, readOnly?, run(ctx, service, params) }`,
served by `GET/POST /{admin,portal}/services/:id/extras[/:action]`; the worker runs them and returns the result,
and a `newPassword` in the result is stored as the service password). `packages/provisioner-skrime` is the reference.

```ts
// packages/provisioner-acme/src/index.ts
import { defineProvisioner } from '@provisia/module-sdk';
import { z } from 'zod';

/** Product-level configuration (set per product in the admin). Server credentials come from ctx.credentials. */
const configSchema = z.object({
  plan: z.string().min(1),                    // remote package/plan name, e.g. from listRemoteOptions('plan')
  diskQuotaMb: z.coerce.number().int().positive().default(10_240),
});

export default defineProvisioner({
  id: 'acme-panel',
  name: 'Acme Panel',
  version: '0.1.0',
  configSchema,

  async testConnection(ctx, server) {
    try {
      await panel(ctx, server.hostname, 'GET', '/api/version');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async create(ctx, service) {
    if (!service.server) throw new Error('service has no server assigned');
    const username = (service.username ?? service.domain?.replace(/\W/g, '').slice(0, 8) ?? `u${service.id.slice(0, 7)}`).toLowerCase();
    const password = service.password ?? generatePassword();
    const r = (await panel(ctx, service.server.hostname, 'POST', '/api/accounts', {
      username,
      password,
      domain: service.domain,
      email: service.client.email,
      plan: ctx.config.plan,
      quotaMb: ctx.config.diskQuotaMb,
    })) as { id: string; ip: string };
    return { moduleData: { accountId: r.id }, username, password, ipAddress: r.ip };
  },

  async suspend(ctx, service, reason) {
    await panel(ctx, service.server!.hostname, 'POST', `/api/accounts/${service.moduleData.accountId}/suspend`, { reason });
  },
  async unsuspend(ctx, service) {
    await panel(ctx, service.server!.hostname, 'POST', `/api/accounts/${service.moduleData.accountId}/unsuspend`);
  },
  async terminate(ctx, service) {
    // Idempotent: a 404 means it is already gone.
    await panel(ctx, service.server!.hostname, 'DELETE', `/api/accounts/${service.moduleData.accountId}`, undefined, [404]);
  },

  async changePackage(ctx, service, newProduct) {
    const next = configSchema.parse(newProduct.moduleConfig);
    await panel(ctx, service.server!.hostname, 'PUT', `/api/accounts/${service.moduleData.accountId}`, { plan: next.plan, quotaMb: next.diskQuotaMb });
  },

  async changePassword(ctx, service, password) {
    await panel(ctx, service.server!.hostname, 'PUT', `/api/accounts/${service.moduleData.accountId}/password`, { password });
  },

  async getUsage(ctx, service) {
    const r = (await panel(ctx, service.server!.hostname, 'GET', `/api/accounts/${service.moduleData.accountId}/usage`)) as { diskMb: number; bwMb: number };
    return { diskUsedMb: r.diskMb, diskLimitMb: ctx.config.diskQuotaMb, bandwidthUsedMb: r.bwMb };
  },

  async loginUrl(ctx, service) {
    const r = (await panel(ctx, service.server!.hostname, 'POST', `/api/accounts/${service.moduleData.accountId}/sso`)) as { url: string };
    return r.url;  // single-use, short-lived; the portal redirects immediately
  },

  async listRemoteOptions(ctx, server, kind) {
    if (kind !== 'plan') return [];
    const r = (await panel(ctx, server.hostname, 'GET', '/api/plans')) as { name: string }[];
    return r.map((p) => ({ value: p.name, label: p.name }));
  },
});

async function panel(
  ctx: { credentials: Record<string, unknown>; fetch: typeof fetch; logger: { warn: (o: object, m: string) => void } },
  hostname: string, method: string, path: string, body?: unknown, okStatuses: number[] = [],
) {
  const { apiToken, port = 2087, verifyTls = true } = ctx.credentials as { apiToken: string; port?: number; verifyTls?: boolean };
  const res = await ctx.fetch(`https://${hostname}:${port}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 60_000,
    // verifyTls=false for self-signed panels requires an undici Agent; see provisioner-cpanel for the pattern.
  });
  if (okStatuses.includes(res.status)) return undefined;
  if (!res.ok) throw new Error(`acme-panel ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}

function generatePassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.charAt(b % 56)).join('');
}
```

Rules:

- `ctx.credentials` is the decrypted `servers.credentials_encrypted` JSON. Document the keys your module expects
  in the package README (the admin server form shows a free-form key/value editor plus your documented keys).
- `create` returns `moduleData` (persisted), optional `username` / `password` (the core encrypts the password)
  and `ipAddress`. Later calls get them back as `service.moduleData`, `service.username`, `service.password`
  (only when the operation needs it).
- Make every operation idempotent: `create` should detect an existing account (same username) and adopt it;
  `terminate` tolerates "not found". Jobs retry on failure.
- `testConnection` is called from the admin server form; return `{ ok: false, message }` instead of throwing so
  the message is shown.
- Never persist anything yourself; never store plaintext credentials in `moduleData`.

## 6. Testing a module

Record real sandbox responses once, then replay them. Example with `msw`:

```ts
import { createModuleContext } from '@provisia/module-sdk';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import gateway from './index.js';

const server = setupServer(
  http.post('https://api.acme.example/v1/payments', () => HttpResponse.json({ id: 'pay_1', checkoutUrl: 'https://pay.acme.example/c/1' })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = createModuleContext({
  config: { apiKey: 'sk_test', webhookSecret: 'whsec', testMode: true },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  appUrl: 'https://billing.test',
  webUrl: 'https://billing.test',
});

it('creates a hosted checkout', async () => {
  const res = await gateway.createPayment(ctx, invoiceFixture);
  expect(res).toEqual({ txnId: 'pay_1', redirectUrl: 'https://pay.acme.example/c/1' });
});

it('rejects webhooks with a bad signature', async () => {
  await expect(gateway.handleWebhook(ctx, { method: 'POST', url: '/', headers: { 'x-acme-signature': 'nope' }, rawBody: Buffer.from('{}'), body: {}, query: {} }))
    .rejects.toThrow(/signature/);
});
```

Checklist before opening a PR:

- [ ] `configSchema` validates everything the module reads; secrets marked.
- [ ] All required methods implemented; optional ones only when the provider supports them (do not stub with
      `throw new Error('unsupported')`, leave them out so the UI hides the action).
- [ ] Webhook signature verification + idempotent results (gateways).
- [ ] Retried operations are safe (registrars, provisioners).
- [ ] Tests with mocked HTTP cover success, provider error, timeout; no live credentials in the repo or CI.
- [ ] README: supported features, credential setup at the provider, webhook URL, sandbox instructions.
- [ ] Registered in `apps/api/src/modules/registry.ts`; `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] Changelog entry (`feat(gateway-acme): ...` commit).

## 7. Interface changes

`packages/module-sdk` is shared by every module. **Add, never modify**: new optional methods, new optional DTO
fields, new result variants with a new `kind`. Changing a required signature is a breaking change for every
module and needs a major version and a note in `CHANGELOG.md`.

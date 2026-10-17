# Provisia — Foundation guide

How the skeleton is wired and exactly where a feature agent adds things. Read `ARCHITECTURE.md` first; this
document does not repeat it. Paths are relative to the repo root.

## 1. Run it

```sh
nvm use                                           # Node 22 (.nvmrc). pnpm 12 via corepack / packageManager field
cp .env.example .env                              # set APP_KEY (openssl rand -hex 32) and SESSION_SECRET
podman compose -f deploy/compose.dev.yml up -d    # postgres:16 (:5432), valkey 8 = redis 7 (:6379), mailpit (:1025/:8025)
pnpm install
pnpm db:migrate && pnpm db:seed                   # admin@example.com / admin1234 (SEED_ADMIN_* env), EUR, 27 EU tax rules, demo product
pnpm dev                                          # turbo: api :3001, web :3000, worker
```

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` in every package (turbo) |
| `pnpm lint` / `pnpm lint:fix` | Biome check (format + lint + import sorting) over the whole repo |
| `pnpm test` | vitest in every package that has a `test` script. API integration tests run only when `DATABASE_URL_TEST` is set (the compose stack creates `provisia_test`; `.env.example` has the URL commented out) |
| `pnpm build` | tsup bundles `apps/api` and `apps/worker` to `dist/index.js`; `next build` (standalone) for `apps/web` |
| `pnpm db:generate` | drizzle-kit: diff `packages/db/src/schema` against `packages/db/drizzle` and write a new SQL migration |
| `pnpm db:migrate` / `pnpm db:seed` | apply migrations / idempotent seed |

Environment: every server entrypoint calls `loadEnv()` from `@provisia/shared/env`, which walks up from the
cwd to the first `.env` and loads it without overriding variables already set (so CI/containers win).
`apps/api/src/config.ts` validates the env with zod; the worker does the same inline in `apps/worker/src/index.ts`.

Verified locally and in CI: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` (Forgejo
Actions, `.forgejo/workflows/ci.yml`, Node 22 + Postgres 16 service).

## 2. How the pieces fit

```
packages/shared      zod schemas + types (+ money helpers). Imported by api AND web. Browser-safe except ./env.
packages/db          Drizzle schema, createDb(), migrations, seed. Imported by api, worker, tests.
packages/core        Pure domain logic (money/tax/proration/numbering). Stub; billing agent owns it.
packages/module-sdk  Plugin contract (PaymentGateway/Registrar/Provisioner), ModuleRegistry, encrypt/decrypt.
apps/api             Fastify 5. Imports all of the above plus @provisia/worker/queues to enqueue jobs.
apps/worker          BullMQ workers. Imports db, module-sdk. Exports ./queues (typed enqueue()).
apps/web             Next.js 15. Imports only @provisia/shared (transpilePackages).
```

Build strategy (important when adding dependencies):

- Workspace packages export **TypeScript source** (`"exports": { ".": "./src/index.ts" }`). tsx, vitest,
  drizzle-kit and Next consume it directly; nothing is pre-compiled. Relative imports inside packages use the
  NodeNext style `./file.js` (tsconfig is `module: NodeNext`); `apps/web/next.config.ts` maps `.js` to `.ts` for webpack.
- `apps/api` and `apps/worker` are bundled by tsup with `noExternal: [/^@provisia\//]` and
  `skipNodeModulesBundle: true`: workspace code is inlined, everything from `node_modules` stays external.
- Because inlined package code imports its own dependencies at runtime (e.g. `postgres`, `bullmq`), the repo uses
  `shamefully-hoist=true` (`.npmrc`) so they resolve from the root `node_modules`. **Add runtime deps to the
  package that imports them**; you do not need to repeat them in the app's `package.json`.
- pnpm 12 blocks postinstall scripts by default. Native deps go in `allowBuilds` in `pnpm-workspace.yaml`.
- Pin exact versions (no `^`). Current pins: TypeScript 5.9.3, Fastify 5.12.7, zod 4.6.7,
  fastify-type-provider-zod 7.0.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, bullmq 6.3.16, ioredis 5.11.1,
  Next 15.5.28, React 19.3.1, Tailwind 4.3.3, @tanstack/react-query 5.104.3, vitest 5.0.5, Biome 2.5.15, turbo 2.11.9.

## 3. Conventions that are already enforced

- **Money**: `bigint` columns in `mode: 'number'` = integer cents (`money()` helper in `packages/db/src/schema/_common.ts`),
  `currency` `char(3)`. In TS use `Money = { amount, currency }` and the helpers in `@provisia/shared` (`addMoney`,
  `multiplyMoney`, `taxOn`, `roundHalfUp`, `formatMoney`, `parseMoney`, `toDecimalString`). Percentages (tax rates) are
  `numeric(5,2)` in the DB and decimal **strings** (`"21.00"`) in DTOs.
- **IDs**: `id()` from `_common.ts` = uuid v7 generated app-side (`uuidv7()` exported by `@provisia/db`).
- **Timestamps**: `createdAt()` / `updatedAt()` from `_common.ts` (timestamptz, `updatedAt` auto-bumps via `$onUpdateFn`).
- **Encrypted at rest**: `encrypt()/decrypt()/encryptJson()/decryptJson()` from `@provisia/module-sdk`
  (AES-256-GCM, key = `APP_KEY`). Columns are named `*_encrypted`. Never return them from the API.
- **Errors**: throw `AppError(code, message, status?, details?)` or the helpers (`notFound()`, `forbidden()`,
  `conflict()`, `badRequest()`, `unauthorized()`) from `apps/api/src/lib/errors.ts`. The error handler emits
  `{ error: { code, message, details? } }`; zod body/query failures become `400 validation_error`.
- **Pagination**: parse query with `paginationQuerySchema`, compute `pageOffset(q)`, return `paginate(rows, total, q)`;
  response schema `paginatedSchema(itemSchema)`. Single resources use `dataSchema(itemSchema)` → `{ data }`.
- **Auth**: `request.auth` is `null` or `{ user: AuthUser, via: 'session' | 'api_key', sessionId?, apiKeyId? }`.
  Guards from `apps/api/src/lib/auth.ts`: `requireStaff` (admin+staff) for `/admin/*`, `requireClient` for `/portal/*`,
  `requireAuth`, or `requireRole('admin')`. Session cookie `pv_session` (signed, httpOnly, SameSite=Lax).
  API keys: `Authorization: Bearer pv_...`, sha256 at rest; create with `createApiKey(db, { userId, name })`
  (`apps/api/src/lib/api-key.ts`). CSRF: cookie-authenticated mutations must come from `WEB_URL`/`APP_URL`
  origin (checked in `apps/api/src/plugins/auth.ts`). TOTP is **not** implemented yet (table `totp_secrets` exists).
- **Audit**: every mutation calls `await activityLog(req, { action: 'client.update', entityType: 'client', entityId, diff })`
  from `apps/api/src/lib/activity-log.ts` (`systemActivityLog(db, …)` outside requests).
- **Settings**: key/value rows typed by `settingsSchema` in `packages/shared/src/settings.ts`; read them with
  `parseSettings(rows)` (defaults applied). Add keys as `'namespace.key': z…default(...)`.
- **Modules never run inline in HTTP** except `handleWebhook` and `checkAvailability`; everything else is a worker job.

## 4. Add a database table / schema file

1. Create `packages/db/src/schema/<feature>.ts` (or extend the area file you own). Use `id()`, `createdAt()`,
   `updatedAt()`, `money()`, `currency()` from `./_common.js`; reference other tables by importing them
   (`import { clients } from './clients.js'`). Enums: `pgEnum('name', [...])`. Add `relations()` if you use the
   relational query API.
2. Register it with **one line** in `packages/db/src/schema/index.ts`: `export * from './<feature>.js';`
3. Run `pnpm db:generate --name <feature>` (writes `packages/db/drizzle/000N_<feature>.sql` + journal). Review the SQL.
   Commit it. Never edit an applied migration.
4. `pnpm db:migrate`. If the seed needs data for your feature, extend `packages/db/src/seed.ts` — keep it idempotent
   (`onConflictDoNothing` / check-then-insert).

Existing schema files: `auth.ts` (users, sessions, api_keys, totp_secrets), `clients.ts` (clients, client_contacts),
`catalog.ts` (product_groups, products, product_prices, billing_cycle enum), `services.ts`, `domains.ts`, `servers.ts`,
`billing.ts` (invoices, invoice_items, transactions, credit_notes, tax_rules), `tickets.ts` (ticket_departments,
tickets, ticket_replies), `orders.ts` (orders, order_items), `system.ts` (activity_log, email_templates, email_log,
settings, jobs_log).

## 5. Add shared zod schemas / DTOs

1. Create `packages/shared/src/<feature>.ts`. Reuse primitives from `./common.js` (`uuidSchema`, `emailSchema`,
   `countryCodeSchema`, `currencyCodeSchema`, `minorUnitsSchema`, `isoDateSchema`, `timestampSchema`,
   `billingCycleSchema`). Export `xSchema` + `type X = z.infer<…>`, and `createXSchema` / `updateXSchema` for inputs.
2. Register with **one line** in `packages/shared/src/index.ts`: `export * from './<feature>.js';`
3. Keep the file browser-safe (no `node:*` imports). Node-only helpers go behind a subpath export like `./env`.

Existing DTO files: `users.ts`, `auth.ts`, `clients.ts`, `catalog.ts`, `services.ts`, `domains.ts`, `billing.ts`,
`tickets.ts`, `servers.ts`, `orders.ts`, `settings.ts`, plus `common.ts`, `pagination.ts`, `errors.ts`, `money.ts`.

## 6. Add an API module

Folder convention: `apps/api/src/modules/<feature>/{routes.ts,service.ts,schemas.ts}` (+ `*.test.ts`).

- `schemas.ts`: re-export from `@provisia/shared` and add module-private request schemas (params, query).
- `service.ts`: functions taking `(db: Db, …)` — no Fastify types, unit-testable.
- `routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireStaff } from '../../lib/auth.js';
import { clientSchema, createClientSchema, dataSchema, paginatedSchema, paginationQuerySchema } from '@provisia/shared';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/admin/clients', {
    preHandler: requireStaff,
    schema: { tags: ['clients'], querystring: paginationQuerySchema, response: { 200: paginatedSchema(clientSchema) } },
  }, async (req) => listClients(app.db, req.query));

  app.post('/admin/clients', {
    preHandler: requireStaff,
    schema: { tags: ['clients'], body: createClientSchema, response: { 201: dataSchema(clientSchema) } },
  }, async (req, reply) => {
    const client = await createClient(app.db, req.body);
    await activityLog(req, { action: 'client.create', entityType: 'client', entityId: client.id });
    return reply.status(201).send({ data: client });
  });
};
export default routes;
```

Register with **one line** in `apps/api/src/modules/index.ts` inside the `/api/v1` block:
`await v1.register(clientsRoutes);` (plus its import). Paths are relative to `/api/v1`: use `/admin/...`,
`/portal/...`, `/public/...`. Everything with a zod `schema` shows up in Swagger at `/api/docs`.

Available on `app`: `app.db` (Drizzle), `app.dbClient` (`{ db, sql, close }`), `app.redis` (ioredis, lazy),
`app.config` (validated env), `app.modules` (`ModuleRegistry`), `app.log`. Enqueue background work with
`import { enqueue } from '@provisia/worker/queues'` → `await enqueue('provisioning', 'create', { serviceId }, { jobId })`.

Per-route rate limits: `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (login does this).

Tests: `apps/api/src/<…>.test.ts`, vitest, `describe.skipIf(!process.env.DATABASE_URL_TEST)`. See
`apps/api/src/app.test.ts` for the pattern (`runMigrations` + `seed` from `@provisia/db/migrate` / `@provisia/db/seed`,
then `buildApp({ config: loadConfig({...}), logger: false })` and `app.inject`).

## 7. Register a plugin module (gateway / registrar / provisioner)

1. Package `packages/<kind>-<name>/src/index.ts`: `export default defineGateway({...})` /
   `defineRegistrar({...})` / `defineProvisioner({...})` from `@provisia/module-sdk`. `ctx.config` is typed from your
   `configSchema`; `ctx.credentials` holds decrypted server credentials; `ctx.fetch(url, { timeoutMs })` times out.
2. Add the dependency to `apps/api/package.json` and `apps/worker/package.json` (`"@provisia/gateway-x": "workspace:*"`).
3. One import + one array entry in `apps/api/src/modules/registry.ts` (`gateways`, `registrars`, `provisioners`).
   The worker should call the same `loadModules()`; import it from the api module or duplicate the list in the worker
   when you wire module jobs.

## 8. Add a worker job

1. Declare the payload: one line in the `JobPayloads` interface in `apps/worker/src/queues.ts`, e.g.
   `provisioning: { create: { serviceId: string }; suspend: { serviceId: string; reason?: string } }`.
2. Implement `apps/worker/src/jobs/<queue>/<job>.ts`:

```ts
import type { JobHandler } from '../../context.js';
import type { JobData } from '../../queues.js';
export const create: JobHandler<JobData<'provisioning', 'create'>> = async (ctx, data, job) => {
  // ctx: { db, redis, logger, appUrl, webUrl }
  return { ok: true }; // stored in jobs_log.result
};
```

3. One line in `apps/worker/src/jobs/index.ts`: `provisioning: { create },`. The worker wraps every run with a
   `jobs_log` row (running → completed/failed), retries 3x with exponential backoff, and refuses unknown job names.
4. Repeatable jobs: one line in `apps/worker/src/schedules.ts`
   (`{ queue: 'billing', name: 'generateInvoices', data: {}, pattern: '0 3 * * *' }` or `every: ms`).
   Scheduler id is `${queue}:${name}`; `maintenance:heartbeat` runs every 5 minutes as the example.

Queues: `billing`, `provisioning`, `domains`, `email`, `maintenance`. Producers: `enqueue(queue, name, data, opts)`;
use a deterministic `opts.jobId` for idempotency.

## 9. Add a web page

- Admin pages: `apps/web/app/admin/<feature>/page.tsx` (layout `apps/web/app/admin/layout.tsx` provides the sidebar
  and an `AuthGuard` for `admin`/`staff`). Nav entries: `apps/web/components/admin-nav.ts`.
- Portal pages: `apps/web/app/portal/<feature>/page.tsx` (top nav + `AuthGuard`). Nav: `apps/web/components/portal-nav.ts`.
- Placeholder pages already exist for every nav item; replace their body. Use `<PageHeader title description>`
  from `apps/web/components/page-header.tsx`.
- Data: add an endpoint group to `apps/web/lib/api.ts` (`api.clients.list = (q) => http.get<Paginated<Client>>('/admin/clients', q)`)
  with types from `@provisia/shared`, then use TanStack Query in a `'use client'` component
  (`useQuery({ queryKey: ['clients', q], queryFn: () => api.clients.list(q) })`). Errors are `ApiError { status, code, message, details }`.
- Current user: `useMe()` / `useLogout()` from `apps/web/lib/auth.ts`.
- UI: shadcn/ui components in `apps/web/components/ui` (button, card, input, label, table, dialog, dropdown-menu, form,
  sonner, badge, tabs, sheet, separator, avatar, skeleton). Add more with
  `cd apps/web && pnpm dlx shadcn@4.22.0 add <name>`, then pin any new dependency versions it writes.
  Toasts: `import { toast } from 'sonner'`. Forms: react-hook-form + `zodResolver(schema)` with the shared zod schema.
- `apps/web/middleware.ts` redirects `/admin/*` and `/portal/*` to `/login?next=…` when the `pv_session` cookie is absent;
  `AuthGuard` handles expired sessions and role mismatches client-side.
- Browser → API: `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`), cookies included; CORS allows `WEB_URL`.

## 10. Deploy

`deploy/compose.dev.yml` is for local development only. `deploy/containerfiles/` and `deploy/quadlets/` are owned by the
deployment agent. Build outputs: `apps/api/dist/index.js`, `apps/worker/dist/index.js` (run with `node`, need
`node_modules` from `pnpm install --prod` with the same `.npmrc`), `apps/web/.next/standalone`.

## 11. Deviations from ARCHITECTURE.md

- Local Redis is `valkey/valkey:8` (Redis 7 protocol compatible) rather than the `redis` image, because Valkey is OSS-licensed.
- CI runs on Forgejo Actions (`.forgejo/workflows/ci.yml`), not GitHub Actions (updated in ARCHITECTURE.md layout).
- `ModuleContext` carries `webUrl` in addition to the listed `appUrl`, `config`, `credentials`, `logger`, `fetch`.

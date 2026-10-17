# Domains module

Owner: domains agent. Files: this folder, `packages/registrar-skrime/`, `apps/worker/src/jobs/domains.ts`,
`packages/shared/src/domains.ts`, `packages/db/src/schema/domains.ts`.

## Tables (`packages/db/src/schema/domains.ts`)

| Table | Purpose |
|---|---|
| `registrar_accounts` | One row per configured registrar module; `config_encrypted` holds the module config (API key) AES-256-GCM encrypted. |
| `tlds` | Sellable TLD catalog: registrar assignment, min/max years, EPP required, ID protection, grace/redemption windows, registry extra fields. |
| `tld_prices` | Sell prices per `(tld, years, currency)` for register/renew/transfer plus imported `cost_*` columns. Missing N-year rows fall back to 1-year × N. |
| `domain_contacts` | Reusable WHOIS contact handles per client (`registrar_handles` keeps registrar-side ids). |
| `domains` | The domain itself (see lifecycle). New columns: `registrar_status`, `*_contact_id`, `last_error`, `last_synced_at`, `expiry_notices_sent`, `auto_renew_invoiced_at`. |
| `domain_sync_log` | Every worker interaction (`ok` / `failed` / `skipped`) with the transition performed. |
| `domain_alerts` | Admin notifications raised by the worker; acknowledged via the API. |

## Lifecycle

```
                 register job                sync job / completed result
  pending ───────────────────────► pending_registration ───────────────────► active
     │                                      │  (registrar rejected: stays, alert raised)
     │ transfer job                         │
     └────────────────► pending_transfer ───┴───── sync (info.status=active) ───► active
                              │
                              └── sync (transferred_away / admin) ──► cancelled

  active ── sync: expiry < today ──► expired ── sync: > grace days ──► redemption ── sync: > grace+redemption ──► cancelled
    │           ▲                      │  renew job (new expiry)        │  renew job (restore)
    │           └──────────────────────┴───────────────────────────────┘
    └── sync: info.status = transferred_away ──► transferred_away
```

| From | To | Moved by |
|---|---|---|
| `pending` | `pending_registration` | `domains:register` (registrar accepted, result `pending`) |
| `pending` / `pending_registration` | `active` | `domains:register` (result `completed`) or `domains:sync` (`getInfo` = active) |
| `pending` | `pending_transfer` | `domains:transfer` (registrar accepted) |
| `pending_transfer` | `active` | `domains:sync` (`getInfo` = active) |
| `active` | `expired` | `domains:sync` (expiry date in the past) |
| `expired` | `redemption` | `domains:sync` (past `tlds.grace_period_days`) |
| `redemption` | `cancelled` | `domains:sync` (past grace + `redemption_period_days`) |
| `expired` / `redemption` | `active` | `domains:renew` (new expiry) |
| `active` | `transferred_away` | `domains:sync` (`getInfo` = transferred_away) |
| any | any (checked against `DOMAIN_STATUS_TRANSITIONS`, `force` bypasses) | admin `POST /admin/domains/:id/status` |

Failures: the job writes `domain_sync_log(status='failed')`, sets `domains.last_error`, and inserts a
`domain_alerts` row (`kind = <job>_failed`). Retryable registrar errors (5xx, timeouts, 429) are re-thrown so
BullMQ retries 3× with exponential backoff; permanent errors complete the job and leave the alert.
`getInfo` returning `unknown` raises `registrar_not_found` without changing the status.

## Worker jobs (`apps/worker/src/jobs/domains.ts`, queue `domains`)

| Job | Payload | Schedule | Does |
|---|---|---|---|
| `register` | `{ domainId }` | on demand | `registrar.register`; transitions as above; schedules a follow-up `sync` in 10 min when pending. |
| `transfer` | `{ domainId }` | on demand | `registrar.transfer` with the decrypted EPP code; follow-up `sync` in 1 h. |
| `renew` | `{ domainId, years }` | on demand | `registrar.renew`; resets `expiry_notices_sent` / `auto_renew_invoiced_at` on a new expiry. |
| `sync` | `{ domainId?, push? }` | daily 04:15 (sweep) | Pushes `nameservers` / `contacts` / `lock` when asked, then refreshes expiry, status, nameservers, lock, privacy. |
| `expiryNotices` | `{}` | daily 08:00 | 60/30/7/1 days before expiry: enqueues `email` queue job `send` `{ templateKey: 'domain.expiry_notice' \| 'domain.expiry_autorenew', to, userId, variables }` (idempotent `jobId`), records thresholds in `expiry_notices_sent`. |
| `autoRenew` | `{}` | daily 04:30 | 14 days before expiry for `auto_renew` domains: calls `createRenewalInvoiceItem()`. **Stub** until the billing module exports it (logs, `skipped` sync-log row, `auto_renew_unbilled` alert, marks `auto_renew_invoiced_at`). |
| `fetchEppCode` | `{ domainId }` | on demand | Stores the EPP code encrypted + `moduleData.eppFetchedAt`; the API serves it for 30 days. |
| `importPricing` | `{ registrarModule, markupPercent, createMissing, overwriteSellPrices }` | on demand | `registrar.getTldPricing()` → `tld_prices.cost_*` (and sell prices for new rows or when overwriting). |

The worker builds its own `ModuleRegistry` from the same static list (`registrars = [skrime]`).

## API

Public (rate limited 30/min, cached 120 s in Redis):
- `GET /public/domains/availability?domain=example.nl` or `?sld=example&tlds=nl,de&limit=10` → `{ requested, suggestions[], ttl }`.
  Names we already manage are `taken`; TLDs without registrar are `unknown`. Debounce in the UI (≥ 400 ms).
- `GET /public/tlds`

Admin (`requireStaff`): registrars (`GET/PUT/DELETE /admin/registrars/:module`, masked secrets), TLD CRUD
(`/admin/tlds`, `POST /admin/tlds/import-pricing` → 202 + job), domains (`GET /admin/domains`,
`POST /admin/domains/register|transfer`, `GET/PATCH /admin/domains/:id`, `POST .../status`, `.../registrar`,
`.../renew`, `.../sync`, `.../epp-code`, `GET .../sync-log`), alerts (`GET /admin/domain-alerts`,
`POST /admin/domain-alerts/:id/acknowledge`), contact handles (`/admin/domain-contacts`).

Portal (`requireClient`, scoped to `req.auth.user.clientId`): `GET /portal/domains`, `GET/PATCH /portal/domains/:id`
(nameservers, auto-renew, lock, ID protection, contacts → `sync` job with `push`), `POST .../renew`,
`POST .../epp-code`, `/portal/domain-contacts` CRUD. Purchases go through the orders module (below), not the portal.

Error codes added: `registrar_not_installed`, `registrar_not_configured`, `registrar_unsupported` (e.g. lock on
Skrime), `tld_not_offered`, `tld_has_no_registrar`, `domain_contact_required`, `domain_price_missing`,
`invalid_status_transition`.

Lock: `domains.locked` is stored locally for every registrar; pushing it requires `Registrar.setLock`, otherwise
the update is rejected with `registrar_unsupported`. Skrime does not expose a lock endpoint.

## Ordering (for the billing/orders agent)

`apps/api/src/modules/domains/order-item.ts` (also re-exported from `./routes.js`):

```ts
import { createDomainOrderItem, activateDomainOrderItem } from '../domains/order-item.js';

// 1. While building the cart / quote (pure read, no registrar call):
const line = await createDomainOrderItem(app.db, {
  type: 'domain_register',          // or 'domain_transfer' (+ eppCode)
  domain: 'example.nl',
  years: 2,
  registrantContactId,              // or inline `contacts`
  idProtection: false,
  autoRenew: true,
});
// line: { type, domainName, tld, registrarModule, quantity (years), billingCycle, currency, amount,
//         setupFee, renewAmountPerYear, description, config }  -> store as order_items row
//         (quantity, billingCycle, amount, setupFee, domainName, config map 1:1)

// 2. When the order's invoice is paid:
const { domain, job } = await activateDomainOrderItem(app.db, line, order.clientId, { appKey: app.config.APP_KEY });
// -> inserts the `domains` row (status pending) and enqueues domains:register / domains:transfer.
//    Set order_items.domain_id = domain.id.
```

Both throw `AppError` with the codes above. Renewals charged through billing should call
`startRenewal(db, domainId, years)` from `./service.js` after payment; `domains:autoRenew` will call the billing
function `createRenewalInvoiceItem` once it exists (see the TODO in the worker file).

## Tests

- `packages/registrar-skrime`: `pnpm --filter @provisia/registrar-skrime test` (msw, no network).
- API: `apps/api/src/modules/domains/domains.test.ts` runs when `DATABASE_URL_TEST` is set
  (`createdb provisia_domains`, `DATABASE_URL=... pnpm --filter @provisia/db exec drizzle-kit push`). The worker
  job registry is exercised through the enqueue calls (BullMQ needs Redis on `REDIS_URL`).

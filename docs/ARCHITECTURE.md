# Provisia — Architecture Contract

Open source alternative to WHMCS / Blesta: billing, provisioning, domains and support for web hosting companies.
License: AGPL-3.0. Single-tenant, self-hosted. First market: EU / Netherlands.

This document is the **shared contract** between all agents working on the codebase. Do not deviate from it
without updating this file. Keep it short and precise.

## 1. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5.x, `strict: true`, ESM everywhere, Node 22 LTS |
| Package manager | pnpm workspaces (monorepo), Turborepo for task orchestration |
| API | Fastify 5 + `@fastify/swagger` (OpenAPI 3.1 generated from zod schemas via `fastify-type-provider-zod`) |
| Database | PostgreSQL 16, Drizzle ORM, migrations via `drizzle-kit` |
| Queue / cron | BullMQ on Redis 7 (Valkey compatible) |
| Web | Next.js 15 (app router), React 19, Tailwind 4, shadcn/ui, TanStack Query |
| Validation | zod (single source of truth for API + forms) |
| Auth | Email + password (argon2id), TOTP 2FA, session cookies for web, API keys (`Authorization: Bearer pv_...`) for integrations |
| Email | nodemailer (SMTP out), IMAP ingest (`imapflow`) for ticket piping, MJML-free handlebars templates |
| PDF | `@react-pdf/renderer` for invoices |
| Tests | vitest (unit + integration), Playwright (e2e, later) |
| Lint/format | Biome |
| Containers | Containerfiles (OCI), **podman quadlets** for deployment |

## 2. Repository layout and ownership

```
provisia/
├── apps/
│   ├── api/            # Fastify HTTP API            (owner: api/auth agent + feature agents add routes under src/modules/<feature>/)
│   ├── web/            # Next.js: /admin/* and /portal/*   (owner: admin-ui agent for /admin, portal-ui agent for /portal)
│   └── worker/         # BullMQ workers + schedulers  (owner: automation agent)
├── packages/
│   ├── db/             # Drizzle schema + migrations + seed (owner: foundation; feature agents ADD tables in their own schema file)
│   ├── core/           # Pure domain logic, no IO: money, tax, proration, invoice numbering, dunning rules (owner: billing agent)
│   ├── shared/         # zod schemas + TS types shared between api and web (each feature agent adds its own file)
│   ├── module-sdk/     # Interfaces + registry for PaymentGateway / Registrar / Provisioner / plugin hooks (owner: foundation, frozen after)
│   ├── gateway-stripe/ gateway-paypal/ gateway-mollie/ gateway-btcpay/   (owner: payments agent)
│   ├── registrar-skrime/                                                  (owner: domains agent)
│   ├── provisioner-cpanel/ provisioner-plesk/ provisioner-directadmin/ provisioner-proxmox/ (owner: provisioning agent)
│   └── email/          # templates + mailer + imap ingest (owner: support agent)
├── deploy/
│   ├── containerfiles/ # api, web, worker
│   └── quadlets/       # *.container, *.pod, *.network, *.volume, env templates
├── docs/
└── .forgejo/workflows/   # Forgejo Actions CI
```

Rules:
- A feature agent only creates/edits files inside the directories it owns, plus: its own `packages/db/src/schema/<feature>.ts`,
  its own `packages/shared/src/<feature>.ts`, its own `apps/api/src/modules/<feature>/`. Register routes/schemas in the
  index files via one-line additions.
- Never rewrite another agent's file. If you need an interface change in `module-sdk`, add, don't modify.

## 3. Core domain model (tables, in `packages/db`)

Money is stored as **integer minor units** (`bigint`, cents) with a 3-letter `currency` column. Default currency EUR.
All timestamps `timestamptz`. All PKs are `uuid` (v7). Soft delete only where legally required (invoices are never deleted).

- `users` (staff + clients share one table; `role` enum: `admin`, `staff`, `client`), `sessions`, `api_keys`, `totp_secrets`
- `clients` (company, VAT number, VAT validated flag, billing address, country, language, currency, credit_balance)
- `client_contacts` (sub-users / contacts with permission flags)
- `product_groups`, `products` (type: `hosting` | `vps` | `domain` | `other`; module + module config JSON),
  `product_prices` (billing_cycle enum: `monthly|quarterly|semiannually|annually|biennially|triennially|onetime`, setup_fee, recurring)
- `services` (a purchased product instance: client, product, server, status enum `pending|active|suspended|terminated|cancelled`,
  next_due_date, billing_cycle, recurring_amount, module_data JSON, username/domain)
- `domains` (client, registrar module, tld, status, registration/expiry dates, nameservers JSON, auto_renew, epp_code, contacts)
- `servers` (provisioning module, hostname, credentials encrypted, max_accounts, group)
- `invoices` (client, number (sequential, gap-free, per year: `2026-000001`), status enum `draft|unpaid|paid|cancelled|refunded|collections`,
  issue_date, due_date, subtotal, tax_total, total, paid_at, pdf_path, tax_rate snapshot, reverse_charge flag, notes),
  `invoice_items` (invoice, description, qty, unit_amount, tax_rate, service/domain reference, period_start/end)
- `transactions` (invoice, gateway, gateway_txn_id, amount, fee, type `payment|refund|credit`)
- `credit_notes`
- `tax_rules` (country, EU flag, rate, b2b reverse charge, valid_from)
- `tickets` (client, department, subject, status `open|answered|customer_reply|on_hold|closed`, priority),
  `ticket_replies` (author, body, attachments), `ticket_departments`
- `orders` (cart → order → invoice → service activation), `order_items`
- `activity_log` (audit: actor, action, entity, diff JSON, ip)
- `email_log`, `email_templates`
- `settings` (key/value JSON, typed via zod in `shared`)
- `jobs_log` (worker run history)

## 4. Module SDK (`packages/module-sdk`) — the plugin contract

```ts
export interface ModuleMeta { id: string; name: string; version: string; configSchema: ZodObject }

export interface PaymentGateway extends ModuleMeta {
  capabilities: { refunds: boolean; savedMethods: boolean; recurring: boolean };
  createPayment(ctx: GatewayContext, invoice: InvoiceDTO): Promise<{ redirectUrl?: string; clientSecret?: string; txnId: string }>;
  handleWebhook(ctx: GatewayContext, req: RawRequest): Promise<WebhookResult>;   // must be idempotent
  refund?(ctx: GatewayContext, txn: TransactionDTO, amount: Money): Promise<RefundResult>;
}

export interface Registrar extends ModuleMeta {
  checkAvailability(ctx, domains: string[]): Promise<AvailabilityResult[]>;
  register(ctx, req: RegisterRequest): Promise<DomainResult>;
  transfer(ctx, req: TransferRequest): Promise<DomainResult>;
  renew(ctx, domain: DomainDTO, years: number): Promise<DomainResult>;
  getInfo(ctx, domain: DomainDTO): Promise<DomainInfo>;
  setNameservers(ctx, domain: DomainDTO, ns: string[]): Promise<void>;
  getEppCode(ctx, domain: DomainDTO): Promise<string>;
  setContacts?(ctx, domain: DomainDTO, contacts: Contacts): Promise<void>;
  setLock?(ctx, domain: DomainDTO, locked: boolean): Promise<void>;
  getTldPricing?(ctx): Promise<TldPrice[]>;
}

export interface Provisioner extends ModuleMeta {
  create(ctx, service: ServiceDTO): Promise<ProvisionResult>;      // returns module_data to persist
  suspend(ctx, service: ServiceDTO, reason?: string): Promise<void>;
  unsuspend(ctx, service: ServiceDTO): Promise<void>;
  terminate(ctx, service: ServiceDTO): Promise<void>;
  changePackage?(ctx, service: ServiceDTO, newProduct: ProductDTO): Promise<void>;
  changePassword?(ctx, service: ServiceDTO, password: string): Promise<void>;
  getUsage?(ctx, service: ServiceDTO): Promise<UsageInfo>;
  loginUrl?(ctx, service: ServiceDTO): Promise<string>;           // SSO into the panel
  testConnection(ctx, server: ServerDTO): Promise<{ ok: boolean; message?: string }>;
}
```

`ctx` carries: typed module config, encrypted server credentials, a logger, a `fetch` with timeouts, and `appUrl`.
Modules are registered in a `ModuleRegistry` and discovered via a static list in `apps/api/src/modules/registry.ts`.
All module calls run in the **worker**, never inline in HTTP requests (except `handleWebhook` and `checkAvailability`).

## 5. Billing rules (EU / NL first)

- Invoice numbers sequential and gap-free per calendar year, assigned at the moment of issuing (draft → unpaid), never reused.
- VAT: rate from `tax_rules` by client country; B2B intra-EU with valid VAT number (VIES check, cached) → reverse charge, 0% with note.
  Non-EU → 0% export. NL domestic → 21%. Tax is calculated per line and rounded half-up per invoice total.
- Proration on upgrades/downgrades to next due date; credit balance applied automatically at invoice issue.
- Recurring invoices generated N days before due date (setting, default 14). Dunning: reminders at due, +3, +7; suspend at +N (default 7);
  terminate at +M (default 30); late fee optional fixed or percentage. All configurable.
- Payments are matched by invoice; overpayment → credit balance. All gateway webhooks idempotent (unique on gateway + txn id).

## 6. API conventions

- Base path `/api/v1`. JSON only. Pagination: `?page=&perPage=` → `{ data, meta: { page, perPage, total } }`.
- Errors: `{ error: { code: 'string_code', message, details? } }` with proper HTTP status.
- Admin routes under `/api/v1/admin/*` (role admin/staff), client routes under `/api/v1/portal/*` (role client), public under `/api/v1/public/*`.
- Every mutation writes `activity_log`.
- OpenAPI served at `/api/docs`.

## 7. Security baseline

- Secrets at rest (server passwords, API keys of modules) encrypted with AES-256-GCM using `APP_KEY` from env.
- CSRF protection on cookie sessions, rate limiting on auth and public endpoints, helmet headers.
- Webhook signature verification mandatory per gateway.
- No raw SQL string interpolation; Drizzle query builder only.

## 8. Dev workflow

```
pnpm install
pnpm db:migrate && pnpm db:seed        # seeds an admin user, EUR, NL tax rules, demo product
pnpm dev                                # turbo: api :3001, web :3000, worker
pnpm test / pnpm lint / pnpm typecheck
```
Local infra via `podman compose -f deploy/compose.dev.yml up` (postgres, redis, mailpit).

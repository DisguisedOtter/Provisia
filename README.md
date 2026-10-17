# Provisia

**Open source billing, provisioning, domain and support platform for web hosting companies.**
A self-hosted alternative to WHMCS and Blesta, built for the EU/NL market first. Licensed under the AGPL-3.0.

> Status: early development. The foundation (monorepo, database schema, API skeleton, module SDK, worker, web shell)
> is in place; feature areas are being built on top of it. Not yet production ready.

## Features (target scope)

- **Clients & accounts** – staff and client users, sub-contacts with permissions, email + password with argon2id,
  TOTP 2FA, session cookies for the web app and `pv_` API keys for integrations.
- **Catalog** – product groups, products (hosting, VPS, domain, other), per-cycle pricing and setup fees.
- **Billing** – gap-free sequential invoice numbers per year, EU VAT with VIES reverse charge, proration,
  credit balance, recurring invoicing, configurable dunning (reminders, suspend, terminate), credit notes, PDF invoices.
- **Payments** – pluggable gateways (Stripe, PayPal, Mollie, BTCPay) with idempotent webhooks and refunds.
- **Provisioning** – pluggable provisioners (cPanel, Plesk, DirectAdmin, Proxmox) run from the background worker.
- **Domains** – pluggable registrars, availability checks, registration, transfers, renewals, nameservers, EPP codes.
- **Support** – ticket departments, tickets and replies, IMAP email piping.
- **Admin panel and client portal** – Next.js app router, Tailwind 4, shadcn/ui.
- **Audit trail** – every mutation writes to `activity_log`.

## Stack

TypeScript (strict, ESM) on Node 22 · Fastify 5 + zod + OpenAPI · PostgreSQL 16 + Drizzle ORM · BullMQ on Redis/Valkey ·
Next.js 15 + React 19 + Tailwind 4 + shadcn/ui + TanStack Query · vitest · Biome · pnpm workspaces + Turborepo ·
OCI containers with podman quadlets.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture contract and
[docs/FOUNDATION.md](docs/FOUNDATION.md) for where things live and how to extend them.

## Quick start (development)

Requirements: Node 22 (`.nvmrc`), pnpm 12 (`corepack enable`), podman (or docker) with compose.

```sh
git clone <this repo> provisia && cd provisia
cp .env.example .env                       # set APP_KEY (openssl rand -hex 32) and SESSION_SECRET
podman compose -f deploy/compose.dev.yml up -d   # postgres:16, valkey (redis 7 compatible), mailpit
pnpm install
pnpm db:migrate && pnpm db:seed            # admin@example.com / admin1234, EUR, EU tax rules, demo product
pnpm dev                                   # api http://localhost:3001, web http://localhost:3000, worker
```

- API docs (OpenAPI/Swagger UI): http://localhost:3001/api/docs
- Admin: http://localhost:3000/admin · Client portal: http://localhost:3000/portal · Mailpit: http://localhost:8025

Other commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm db:generate` (after schema changes).

## Repository layout

```
apps/api        Fastify HTTP API (/api/v1)
apps/web        Next.js admin panel (/admin) and client portal (/portal)
apps/worker     BullMQ workers and schedulers
packages/db     Drizzle schema, migrations, seed
packages/core   Pure domain logic (money, tax, proration, numbering)
packages/shared zod schemas + types shared by api and web
packages/module-sdk  Plugin contract: PaymentGateway, Registrar, Provisioner
deploy/         compose for dev, Containerfiles and podman quadlets for production
.forgejo/workflows   CI (Forgejo Actions)
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Development happens on Forgejo; CI runs via Forgejo Actions.

## License

Provisia is free software released under the [GNU Affero General Public License v3.0](LICENSE).
If you run a modified version as a network service you must make the modified source available to its users.

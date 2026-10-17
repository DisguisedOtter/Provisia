# Provisia

**Open source billing, provisioning, domain and support platform for web hosting companies.**
A self-hosted alternative to WHMCS and Blesta, built for the EU/NL market first. Licensed under the AGPL-3.0.

[![CI](../../actions/workflows/ci.yml/badge.svg?branch=main)](../../actions?workflow=ci.yml)
[![Security](../../actions/workflows/security.yml/badge.svg?branch=main)](../../actions?workflow=security.yml)
[![Release](../../actions/workflows/release.yml/badge.svg)](../../releases)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> Status: early development. The foundation (monorepo, database schema, API skeleton, module SDK, worker, web shell)
> is in place and the feature areas (billing, payments, provisioning, domains, support, admin UI, portal) are being
> built on top of it. The deployment path — container images, podman quadlets with automatic HTTPS, installer,
> backup/restore, release pipeline — is complete and tested. Not yet production ready: wait for the first tagged
> release (`v0.1.0`) before running it for real customers.

## Features (target scope)

- **Clients & accounts** – staff and client users, sub-contacts with permissions, email + password with argon2id,
  TOTP 2FA, session cookies for the web app and `pv_` API keys for integrations.
- **Catalog** – product groups, products (hosting, VPS, domain, other), per-cycle pricing and setup fees.
- **Billing** – gap-free sequential invoice numbers per year, EU VAT with VIES reverse charge, proration,
  credit balance, recurring invoicing, configurable dunning (reminders, suspend, terminate), credit notes, PDF invoices.
- **Payments** – pluggable gateways (Stripe, PayPal, Mollie, BTCPay) with idempotent webhooks and refunds.
- **Provisioning** – pluggable provisioners (cPanel, Plesk, DirectAdmin, Proxmox) run from the background worker.
- **Reselling** – resell Skrime webspace and KVM servers through the Skrime reseller API (`skrime_webspace`, `skrime_server`).
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
More in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); plugin authors start at [docs/MODULES.md](docs/MODULES.md).

## Install (production)

Provisia ships as four container images (`api`, `worker`, `web`, `migrate`) plus PostgreSQL 16, Valkey and a
Caddy proxy with automatic HTTPS, all managed by **systemd through podman quadlets** — rootless by default,
no Kubernetes required. Requirements: a Linux host with podman ≥ 4.4 and systemd, a DNS name, ports 80/443.

```sh
# on the server, as the (rootless) service user
curl -fsSLO https://FORGEJO_HOST/OWNER/provisia/releases/download/vX.Y.Z/provisia-quadlets-vX.Y.Z.tar.gz
tar -xzf provisia-quadlets-vX.Y.Z.tar.gz && cd provisia-quadlets-vX.Y.Z
./scripts/install.sh --registry FORGEJO_HOST/OWNER --tag vX.Y.Z --domain billing.example.com --email you@example.com
```

The installer checks podman/systemd, installs the units to `~/.config/containers/systemd/`, generates `APP_KEY`,
`SESSION_SECRET` and the database password into `~/.config/provisia/provisia.env`, runs the migration job and
starts the stack; it prints the admin login at the end.

| Topic | Document |
|---|---|
| Step-by-step install, DNS/TLS, first login, SMTP, payment gateway | [docs/INSTALL.md](docs/INSTALL.md) |
| Upgrades (pinned tags or `podman auto-update`), rollback | [docs/UPGRADE.md](docs/UPGRADE.md) |
| Backups (`scripts/backup.sh`), restore, retention | [docs/BACKUP.md](docs/BACKUP.md) |
| Every environment variable | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| Images and how they are built | [deploy/containerfiles/README.md](deploy/containerfiles/README.md) |
| Security policy | [SECURITY.md](SECURITY.md) |

Images are built and published by `.forgejo/workflows/release.yml` on every `v*` tag to the Forgejo container
registry of the instance hosting the repository, together with the quadlet bundle on the release page.

## Repository layout

```
apps/api        Fastify HTTP API (/api/v1)
apps/web        Next.js admin panel (/admin) and client portal (/portal)
apps/worker     BullMQ workers and schedulers
packages/db     Drizzle schema, migrations, seed
packages/core   Pure domain logic (money, tax, proration, numbering)
packages/shared zod schemas + types shared by api and web
packages/module-sdk  Plugin contract: PaymentGateway, Registrar, Provisioner
deploy/         compose.dev.yml (dev), containerfiles/ (images), quadlets/ + caddy/ (production)
scripts/        install.sh, backup.sh, restore.sh, changelog.sh
docs/           architecture, foundation, install, upgrade, backup, configuration, development, modules
.forgejo/       workflows (ci, release, security), issue and PR templates
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Development happens on Forgejo; CI runs via Forgejo Actions.

## License

Provisia is free software released under the [GNU Affero General Public License v3.0](LICENSE).
If you run a modified version as a network service you must make the modified source available to its users.

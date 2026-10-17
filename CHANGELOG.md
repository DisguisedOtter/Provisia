# Changelog

All notable changes to Provisia are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Release notes are generated from
[Conventional Commits](https://www.conventionalcommits.org/) by `scripts/changelog.sh`; paste the output here
when cutting a release.

## [Unreleased]

### Added

- Monorepo foundation: database schema, Fastify API, BullMQ worker, Next.js admin panel and client portal, module SDK.
- Container images (`api`, `worker`, `web`, `migrate`), podman quadlets with Caddy automatic HTTPS, `scripts/install.sh`,
  `scripts/backup.sh`, `scripts/restore.sh`.
- Forgejo Actions: CI, release (images + quadlet bundle), security scans.
- Auth: registration with email verification, password reset, TOTP 2FA with backup codes, brute-force lockout,
  staff roles and permissions, scoped API keys, impersonation, session management, auto-audit of admin mutations.
- Clients, catalog, services (upgrades with proration, cancellations), orders (cart, quote, accept → services + invoice),
  invoices (gap-free numbering, EU VAT with VIES reverse charge, credit notes, PDF), payments (Stripe, PayPal, Mollie,
  BTCPay gateways, saved methods, autopay, webhooks, reconciliation), dunning and recurring billing jobs.
- Domains: Skrime registrar, TLD pricing, availability search, registration/transfer/renewal, nameservers, EPP codes.
- Provisioning: cPanel, Plesk, DirectAdmin and Proxmox modules, server groups, usage sync, provisioning log.
- Reselling: Skrime webspace and KVM server provisioners (`packages/provisioner-skrime`) on top of the Skrime
  registrar client; power control, reinstall, password reset, usage and cost price per service.
- Support: departments with IMAP piping, tickets, replies, internal notes, canned responses, attachments, notifications,
  e-mail templates (EN/NL) and e-mail log.
- Admin panel (dashboard, clients, products, services, orders, invoices, transactions, domains, servers, tickets,
  settings) and client portal (services, invoices with online payment, domains, tickets, account) in Next.js.

### Changed

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: ../../compare/v0.1.0...HEAD

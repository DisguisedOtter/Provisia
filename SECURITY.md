# Security policy

Provisia handles invoices, payment flows and credentials for hosting control panels and registrars.
We take reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public issue.** Report privately:

- Preferred: a confidential issue on the Forgejo instance (tick "This issue is confidential"), or
- e-mail the maintainers at the address in the repository description / `package.json` author field, with
  `[SECURITY]` in the subject. Ask for a PGP key in a first message if you need to send sensitive details.

Please include: affected version or commit, component (api, web, worker, a module, the deployment), steps to
reproduce or a proof of concept, and the impact you see. You will get an acknowledgement within 3 business days
and a status update at least every 14 days until the issue is resolved.

## Scope

In scope: everything in this repository — the API, web app, worker, module SDK and the bundled modules, the
container images, quadlets, install/backup scripts and the CI workflows.

Out of scope: vulnerabilities in third-party services the modules talk to (payment providers, registrars,
control panels), issues that require a compromised host or administrator account, and findings from automated
scanners without a demonstrated impact (we run `pnpm audit` and Trivy ourselves, see `.forgejo/workflows/security.yml`).

## Supported versions

Pre-1.0: only the latest minor release receives security fixes. After 1.0 the latest minor of the current major
and the last minor of the previous major are supported for 6 months after a new major is released.

Security fixes are released as patch versions and called out under "Security" in `CHANGELOG.md` and the
release notes. Operators who enabled `podman-auto-update.timer` receive them automatically (see `docs/UPGRADE.md`).

## Hardening notes for operators

- Keep `APP_KEY`, `SESSION_SECRET` and `provisia.env` at mode 0600 and in your encrypted backups
  (`docs/BACKUP.md`, `scripts/backup.sh --age-recipient`). Only the api, worker and migrate containers receive
  that file; proxy, web and valkey have their own secret-free env files.
- Leave `TRUST_PROXY` at its default (`1`, the bundled Caddy) unless you add a CDN or load balancer in front;
  the Caddyfile deliberately trusts no upstream `X-Forwarded-For` (see `docs/INSTALL.md` section 4).
- Inbound ticket e-mail from a staff address is ignored unless you enable
  `support.staffRepliesByEmail` **and** your mailbox provider adds `Authentication-Results` headers
  (SPF/DKIM/DMARC); a forged `From:` must never produce a staff reply.
- Run rootless (the default of `scripts/install.sh`); containers run as a non-root user with
  `NoNewPrivileges`, a read-only root filesystem where possible, and no published ports except the proxy.
- Terminate TLS with the bundled Caddy or your own proxy; never expose the api/web ports directly.
- Restrict `/admin` by IP in the Caddyfile if your staff works from fixed locations.
- Enable two-factor authentication for all staff accounts as soon as it is available in your version.

A more detailed security design (auth, sessions, CSRF, encryption at rest, webhook verification) will be
documented in `docs/SECURITY.md` by the authentication work; until then `docs/ARCHITECTURE.md` section 7 lists
the baseline.

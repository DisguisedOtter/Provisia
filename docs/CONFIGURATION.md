# Configuration reference

Provisia is configured through environment variables only. In production they live in
`~/.config/provisia/` (rootless) or `/etc/provisia/` (rootful) and are passed to the containers by the quadlets
(`EnvironmentFile=`), one file per trust boundary so a container only sees what it needs:

| File | Containers | Contents |
|---|---|---|
| `provisia.env` | api, worker, migrate | secrets (`APP_KEY`, `SESSION_SECRET`, `DATABASE_URL`, `REDIS_URL`, `SMTP_URL`), runtime settings |
| `provisia-db.env` | postgres | `POSTGRES_*` |
| `provisia-valkey.env` | valkey | `VALKEY_PASSWORD` |
| `provisia-proxy.env` | proxy (Caddy) | `PROVISIA_DOMAIN`, `PROVISIA_ACME_EMAIL` |
| `provisia-web.env` | web | public URLs only (`APP_URL`, `WEB_URL`, `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`) |

In development the apps read the repo-root `.env`
(`loadEnv()` from `@provisia/shared/env`; variables already set in the process environment win).

Validation: `apps/api/src/config.ts` (zod) for the API, `apps/worker/src/index.ts` for the worker. An invalid or
missing required value stops the process at boot with a readable message in the logs. With `NODE_ENV=production`
the API also refuses placeholder or low-entropy values for `APP_KEY` and `SESSION_SECRET` (the examples from the
templates, repeated characters, words like `changeme`).

Everything else (company details, tax rules, invoice numbering, dunning schedule, gateway/registrar/server
credentials, e-mail templates) is stored in the database and edited in the admin panel; credentials are
encrypted with `APP_KEY`.

Templates with every variable: `deploy/quadlets/*.env.example` (production), `.env.example` (development).
File syntax is systemd `EnvironmentFile`: `KEY=VALUE`, no `${VAR}` expansion, quote values containing spaces.

## Required

| Variable | Used by | Description |
|---|---|---|
| `DATABASE_URL` | api, worker, migrate | PostgreSQL connection URL, `postgres://user:password@host:5432/dbname`. In the quadlet stack the host is `provisia-postgres` and the password must equal `POSTGRES_PASSWORD` in `provisia-db.env`. Add `?sslmode=require` for an external managed database. |
| `APP_KEY` | api, worker, migrate | 32 random bytes as 64 hex characters (`openssl rand -hex 32`). Key for AES-256-GCM encryption of secrets at rest. **Back it up; changing it makes stored credentials unreadable.** |
| `SESSION_SECRET` | api | At least 32 characters (`openssl rand -hex 32`). Signs the `pv_session` cookie. Rotating it logs every user out. |

## Public URLs

| Variable | Default | Used by | Description |
|---|---|---|---|
| `APP_URL` | `http://localhost:3001` | api, worker | Public base URL of the API (webhook/callback URLs handed to gateways and registrars). Behind the bundled proxy: `https://PROVISIA_DOMAIN`. |
| `WEB_URL` | `http://localhost:3000` | api, worker | Public base URL of the web app (links in e-mails, CORS allow-origin, CSRF origin check). Behind the bundled proxy: same as `APP_URL`. |
| `NEXT_PUBLIC_API_URL` | `APP_URL`, else same origin | web | Base URL the **browser** uses to reach the API; `/api/v1` is appended. Substituted into the web image at container start (`web-entrypoint.sh`); in development it is inlined at build time. |
| `INTERNAL_API_URL` | `APP_URL` | web | URL the web server uses for server-side rendering of public pages (catalog, sitemap). `http://provisia-api:3001` in the stack keeps that traffic off the proxy. |
| `PROVISIA_DOMAIN` | — | proxy (Caddy) | Site address Caddy serves and obtains a certificate for. `localhost` → internal CA; `http://host` → plain HTTP. |
| `PROVISIA_ACME_EMAIL` | — | proxy (Caddy) | ACME account e-mail (certificate expiry notices). |

## Server

| Variable | Default | Used by | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | all | `production` in deployments: JSON logs, no pretty printing, secure cookies. |
| `PORT` | `3001` | api | Listen port. The web container uses `PORT=3000` (set by the quadlet). |
| `HOST` | `0.0.0.0` | api | Listen address. |
| `LOG_LEVEL` | `info` (`debug` in development) | api, worker | `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `SESSION_TTL_DAYS` | `30` | api | Session cookie / server-side session lifetime. |
| `WORKER_CONCURRENCY` | `5` | worker | Jobs processed in parallel per worker process (per queue). Module calls to panels/registrars happen here; raise carefully. |
| `STORAGE_PATH` | `./storage` (dev), `/data/storage` (containers) | api, worker | Directory for invoice PDFs and uploads. Mounted from the `provisia-storage` volume in production; must be shared between api and worker. |
| `REDIS_URL` | `redis://localhost:6379` | api, worker | Valkey/Redis 7 connection (BullMQ queues, rate limits). `redis://:VALKEY_PASSWORD@provisia-valkey:6379` in the stack (the password lives in `provisia-valkey.env`); `rediss://` for TLS. Configure the server with `maxmemory-policy noeviction`. |
| `TRUST_PROXY` | `1` in production, `false` otherwise | api | Which upstream proxies may set `X-Forwarded-For` (the IP used for rate limits, login lockouts and the audit log): a hop count (`1` = the bundled Caddy, `2` = Caddy behind a CDN/load balancer), a comma-separated list of IPs/CIDRs, or `false`. Never trust more hops than you run: a client could otherwise choose its own IP. |
| `WEB_BIND_HOST` | `0.0.0.0` | web | Bind address of the Next.js server (overrides podman's `HOSTNAME`). |

## E-mail

| Variable | Default | Used by | Description |
|---|---|---|---|
| `SMTP_URL` | `smtp://localhost:1025` (dev, mailpit) | api, worker | `smtp://user:pass@host:587` (STARTTLS) or `smtps://user:pass@host:465` (implicit TLS). URL-encode `@`, `:`, `/` in credentials. |
| `MAIL_FROM` | `Provisia <noreply@example.com>` | api, worker | Default sender, `Name <address>`. The domain needs SPF/DKIM at your provider. |

Per-department IMAP settings for ticket piping are configured in the admin panel, not in the environment.

## Migration job / seed (first start only)

| Variable | Default | Used by | Description |
|---|---|---|---|
| `MIGRATE_SEED` | `false` | migrate | `true` runs the idempotent seed after the migrations: admin user, settings defaults, EU VAT rates, demo product. Set back to `false` afterwards. |
| `MIGRATE_WAIT_SECONDS` | `90` | migrate | How long the job waits for PostgreSQL to accept connections. |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | migrate (seed) | First admin login. |
| `SEED_ADMIN_PASSWORD` | `admin1234` | migrate (seed) | First admin password. **Change the default; remove it from the file after the first start.** In production the seed refuses the default, placeholders and anything shorter than 12 characters. |

## Database container (`provisia-db.env`)

| Variable | Description |
|---|---|
| `POSTGRES_USER` | `provisia` — must match the user in `DATABASE_URL`. |
| `POSTGRES_PASSWORD` | Must match the password in `DATABASE_URL`. Changing it later: `ALTER USER provisia PASSWORD '...'` in psql **and** update both files. |
| `POSTGRES_DB` | `provisia`. |

## Valkey container (`provisia-valkey.env`)

| Variable | Description |
|---|---|
| `VALKEY_PASSWORD` | Passed to `valkey-server --requirepass`. Must match the password in `REDIS_URL`. Generate with `openssl rand -hex 24`. |

## Proxy container (`provisia-proxy.env`)

| Variable | Description |
|---|---|
| `PROVISIA_DOMAIN` | Site address Caddy serves and obtains a certificate for. `localhost` → internal CA; `http://host` → plain HTTP. |
| `PROVISIA_ACME_EMAIL` | ACME account e-mail (certificate expiry notices). |

## Development and CI only

| Variable | Description |
|---|---|
| `DATABASE_URL_TEST` | Second database for API integration tests (`provisia_test` in the dev compose stack). Tests are skipped when unset. |
| `CI` | Set by Forgejo Actions; disables interactive prompts and turbo's TUI. |
| `TURBO_TELEMETRY_DISABLED`, `NEXT_TELEMETRY_DISABLED` | `1` in images and CI. |

## Quadlet-level settings (not environment variables)

Edit the unit in `~/.config/containers/systemd/` and `systemctl --user daemon-reload`:

| Setting | File | Default |
|---|---|---|
| Image registry / tag | `Image=` in `provisia-{api,worker,web,migrate}.container` | filled in by `install.sh` |
| Published ports | `PublishPort=` in `provisia-proxy.container` | `80:80`, `443:443`, `443:443/udp` |
| Expose PostgreSQL on the host | `PublishPort=127.0.0.1:5432:5432` in `provisia-postgres.container` | not published |
| Automatic image updates | `AutoUpdate=registry` (all) + `podman-auto-update.timer` | label set, timer off |
| Resource limits | add `[Service] MemoryMax=1G` / `CPUQuota=200%` | none |
| Health checks | `HealthCmd=` … `HealthOnFailure=kill` | api/web: HTTP; worker: process; db/valkey: readiness |

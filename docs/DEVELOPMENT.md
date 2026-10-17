# Development guide

How to work on Provisia itself. `docs/ARCHITECTURE.md` is the contract, `docs/FOUNDATION.md` explains where every
kind of code goes (schema file, shared zod schema, API module, worker job, web page). This document covers the
day-to-day workflow, conventions, CI and container builds.

## 1. Dev stack

```sh
nvm use                                            # Node 22 (.nvmrc)
corepack enable                                    # pnpm (version pinned in package.json "packageManager")
cp .env.example .env                               # set APP_KEY (openssl rand -hex 32) and SESSION_SECRET
podman compose -f deploy/compose.dev.yml up -d     # postgres:16 :5432, valkey :6379, mailpit :1025 (UI :8025)
pnpm install
pnpm db:migrate && pnpm db:seed                    # admin@example.com / admin1234 (SEED_ADMIN_*), EU tax rules, demo product
pnpm dev                                           # turbo: api :3001, web :3000, worker
```

| URL | |
|---|---|
| http://localhost:3000/admin | admin panel |
| http://localhost:3000/portal | client portal |
| http://localhost:3001/api/docs | OpenAPI / Swagger UI (generated from the zod schemas) |
| http://localhost:8025 | mailpit: every e-mail the app sends |

`deploy/compose.dev.yml` also creates a `provisia_test` database for integration tests; uncomment
`DATABASE_URL_TEST` in `.env` to run them. Docker works too (`docker compose -f deploy/compose.dev.yml up -d`).

Reset: `podman compose -f deploy/compose.dev.yml down -v` deletes the data volumes.

## 2. Everyday commands

| Command | |
|---|---|
| `pnpm dev` / `pnpm --filter @provisia/api dev` | all apps, or one |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm lint` / `pnpm lint:fix` | Biome: format, lint, import sorting |
| `pnpm test` / `pnpm --filter @provisia/core test -- --watch` | vitest |
| `pnpm build` | tsup bundles for api/worker, `next build` (standalone) for web |
| `pnpm db:generate --name <feature>` | drizzle-kit: new SQL migration from schema changes |
| `pnpm db:migrate`, `pnpm db:seed` | apply migrations / idempotent seed |
| `pnpm --filter @provisia/db exec drizzle-kit studio` | browse the database |

## 3. Tests

- **Unit tests** live next to the code (`*.test.ts`), vitest, no database. Pure domain logic (`packages/core`)
  must be unit tested exhaustively: money rounding, tax, proration, numbering.
- **API integration tests** (`apps/api/src/**/*.test.ts`) use `describe.skipIf(!process.env.DATABASE_URL_TEST)`,
  need Redis (`REDIS_URL_TEST`, default: database 15 of `REDIS_URL`, set in `apps/api/src/test-setup.ts` so a running
  dev worker never sees test jobs and `flushdb` never wipes dev queues),
  run migrations + seed against `provisia_test`, build the app with `buildApp({ config, logger: false })` and use
  `app.inject()`. See `apps/api/src/app.test.ts`.
- **Modules** (gateways, registrars, provisioners) are tested against recorded or mocked HTTP (`msw` or `nock`),
  never live credentials. Every module package has a `README.md` with sandbox instructions for manual checks.
- **E2E** (Playwright) is planned; until then test UI flows manually against the dev stack.

CI runs `pnpm lint`, `pnpm typecheck`, `pnpm test` (with Postgres) and `pnpm build` on every push and PR.

## 4. Conventions

- TypeScript strict, ESM, NodeNext-style relative imports with `.js` extension inside packages.
- Pin exact dependency versions (no `^`). Add runtime dependencies to the package that imports them
  (`pnpm add <pkg> --filter <workspace>`). Native modules need an `allowBuilds` entry in `pnpm-workspace.yaml`.
- Money: integer minor units + 3-letter currency, always. Percentages are decimal strings.
- Every mutation writes `activity_log`. Every secret column is `*_encrypted` and never leaves the API.
- Errors: `AppError` / helpers, `{ error: { code, message, details? } }`.
- API routes: zod schemas from `@provisia/shared`, `requireStaff` / `requireClient` guards, `/admin`, `/portal`,
  `/public` prefixes. Pagination with `paginationQuerySchema` and `paginatedSchema()`.
- Module calls never run inline in HTTP handlers except `handleWebhook` and `checkAvailability`; everything else is
  a worker job with a deterministic `jobId`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(billing): ...`,
  `fix(api): ...`, `docs: ...`, `ci: ...`; `!` or a `BREAKING CHANGE:` footer for breaking changes.
  `scripts/changelog.sh` builds the release notes from them.
- Formatting is Biome's; `.editorconfig` covers the rest (2 spaces, LF, final newline; tabs in the Caddyfile).

## 5. Adding a module (gateway, registrar, provisioner)

The full author guide, including a minimal working example of each kind, is **`docs/MODULES.md`**. Short version:

1. `pnpm create` a package under `packages/<kind>-<name>/` exporting `defineGateway|defineRegistrar|defineProvisioner({...})`.
2. Add it as `workspace:*` dependency to `apps/api` and `apps/worker`.
3. One import + one array entry in `apps/api/src/modules/registry.ts`.
4. Tests with mocked HTTP, README with sandbox instructions.

## 6. Container images locally

```sh
for i in api worker web migrate; do
  podman build --format docker -f deploy/containerfiles/Containerfile.$i -t provisia-$i:dev .
done
# run against the dev stack (host.containers.internal = your machine from inside podman)
podman run --rm -e MIGRATE_SEED=true -e DATABASE_URL=postgres://provisia:provisia@host.containers.internal:5432/provisia \
  -e APP_KEY=$(openssl rand -hex 32) provisia-migrate:dev
podman run --rm -p 3001:3001 --env-file .env -e DATABASE_URL=postgres://provisia:provisia@host.containers.internal:5432/provisia \
  -e REDIS_URL=redis://host.containers.internal:6379 provisia-api:dev
curl localhost:3001/api/v1/public/health
```

`pnpm install --frozen-lockfile` inside the build fails when `pnpm-lock.yaml` is out of date: run `pnpm install`
and commit the lockfile. `--format docker` keeps the `HEALTHCHECK` (OCI format drops it; the quadlets define
health checks themselves, so production is unaffected).

Quadlets can be validated without a Linux host from the podman machine:
`podman machine ssh 'QUADLET_UNIT_DIRS=/path /usr/libexec/podman/quadlet -dryrun -user'`.

## 7. Forgejo Actions

Workflows live in `.forgejo/workflows/`:

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push to `main`, PRs | install, lint, typecheck, migrate test db, test, build (Node 22 container + Postgres 16 service) |
| `release.yml` | tag `v*` | builds the four images with buildah, pushes them to the Forgejo container registry of the same instance (`<host>/<owner>/provisia-<name>:{vX.Y.Z,X.Y,latest}`), generates release notes with `scripts/changelog.sh`, creates the Forgejo release and attaches `provisia-quadlets-vX.Y.Z.tar.gz` |
| `security.yml` | push, PR, weekly | `pnpm audit --prod --audit-level=high`, Trivy filesystem scan, Trivy scan of the published `latest` images (HIGH/CRITICAL fail, LOW/MEDIUM informational) |

Required secrets for `release.yml` and the image scan: `REGISTRY_USER` and `REGISTRY_TOKEN` (a Forgejo access
token with `write:package`). The release is created with the automatic `GITHUB_TOKEN`.

Cutting a release:

```sh
scripts/changelog.sh v0.1.0 HEAD        # preview the notes, paste into CHANGELOG.md under a new heading
git tag -a v0.2.0 -m "Provisia 0.2.0" && git push origin v0.2.0
```

### Differences from GitHub Actions

Forgejo Actions runs the GitHub workflow syntax on [Forgejo runner](https://forgejo.org/docs/latest/admin/actions/)
(based on `act`). Things that differ:

- **Labels, not VM images.** `runs-on: docker` is a runner label; the job runs in a container, `node:22-bookworm`
  here (JavaScript actions such as `actions/checkout` need Node inside that image). There is no `ubuntu-latest` VM
  unless the runner admin mapped that label.
- **Actions resolve against the instance.** `uses: actions/checkout@v4` is fetched from `code.forgejo.org`
  (or the mirror configured in the runner) rather than github.com. Most popular actions work; third-party actions that
  call the GitHub API do not. Prefer shell steps (`curl`, `buildah`, `node`) as the workflows here do.
- **Building images needs a privileged job container.** `release.yml` sets `container.options: --privileged`;
  the runner's `config.yaml` must allow it (`container.privileged: true` or `container.options`), or use a runner
  with a `podman`/host label. Without it buildah fails on user namespaces / overlay mounts.
- **Services** (`services:` block in `ci.yml`) work like on GitHub, reachable by service name.
- **`${{ github.server_url }}`, `github.api_url`, `github.repository`, `github.token`** are available; the
  registry host is derived from `server_url` because Forgejo's container registry is part of the instance
  (`<host>/<owner>/<package>`). GitHub-only contexts (`github.event.release.*` on `release` events) are not used.
- **Releases are created through the API** (`POST /repos/{owner}/{repo}/releases`, then `/assets`); there is
  no `softprops/action-gh-release`.
- **Caching:** `actions/cache` requires the runner's cache server to be enabled. `ci.yml` uses
  `actions/setup-node` with `cache: pnpm`; if your runner has no cache server the step logs a warning and
  installs from scratch.
- **Matrix, `needs`, `if`, `workflow_dispatch`, `schedule`** behave as on GitHub (schedule needs the Forgejo
  instance setting `[actions] ENABLED` and `DEFAULT_ACTIONS_URL`, and the repository must have Actions enabled).
- Workflow files live in `.forgejo/workflows/`; `.github/workflows/` is also read when present, so keep only one.

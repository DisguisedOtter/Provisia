# Containerfiles

OCI images for the production stack. Build context is always the **repo root** (`.containerignore` trims it).

| File | Image | Runs |
|---|---|---|
| `Containerfile.api` | `provisia-api` | `node apps/api/dist/index.js` (Fastify, port 3001) |
| `Containerfile.worker` | `provisia-worker` | `node apps/worker/dist/index.js` (BullMQ) |
| `Containerfile.web` | `provisia-web` | Next.js standalone server, port 3000 |
| `Containerfile.migrate` | `provisia-migrate` | one-shot: migrations, then seed when `MIGRATE_SEED=true` |

```sh
for i in api worker web migrate; do
  podman build --format docker -f deploy/containerfiles/Containerfile.$i -t provisia-$i:dev .
done
```

Design notes:

- Base image `node:22-bookworm-slim` (glibc: argon2 prebuilt binaries, no compiler at runtime); non-root user
  `provisia` (uid 10001); `tini` as PID 1; OCI labels; `io.containers.autoupdate=registry` for `podman auto-update`.
- `pnpm install --frozen-lockfile` in the `deps` stage; `tsup` bundles the app plus all `@provisia/*` workspace
  packages into one `dist/index.js`; the `prune` stage reinstalls only production dependencies of that app with
  `--node-linker=hoisted`, giving a flat, symlink-free `node_modules` for the runtime stage.
- `Containerfile.web` builds with `NEXT_PUBLIC_API_URL=__PROVISIA_PUBLIC_API_URL__`; `web-entrypoint.sh`
  substitutes the real value at start, so one image serves any hostname.
- `Containerfile.migrate` bundles `packages/db/src/{migrate,seed}.ts` with `migrate.tsup.config.ts` and copies
  `packages/db/drizzle/`; `migrate-entrypoint.sh` waits for PostgreSQL first.
- `HEALTHCHECK` is kept only when building with `--format docker`; the quadlets define `HealthCmd=` explicitly, so
  both formats work in production.

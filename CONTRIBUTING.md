# Contributing to Provisia

Thanks for your interest. Provisia is developed on a Forgejo instance; pull requests and issues go there.

## Ground rules

- Read `docs/ARCHITECTURE.md` first. It is the contract everyone builds on. Do not deviate from it without
  updating the document in the same change.
- Read `docs/FOUNDATION.md` for where code lives and how to add a schema file, shared schema, API module,
  worker job or web page.
- Stay inside your feature's directories (see "Repository layout and ownership" in the architecture doc).
  Register new things with one-line additions to the index files; never rewrite someone else's file.

## Development setup

```sh
nvm use                      # Node 22
corepack enable              # pnpm 12
cp .env.example .env
podman compose -f deploy/compose.dev.yml up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Before you open a pull request

All of the following must pass locally. They also run in CI (`.forgejo/workflows/ci.yml`).

```sh
pnpm lint        # Biome (format + lint). `pnpm lint:fix` auto-fixes.
pnpm typecheck   # tsc --noEmit in every package
pnpm test        # vitest. Integration tests need DATABASE_URL_TEST, otherwise they are skipped.
pnpm build
```

- Schema changes: edit `packages/db/src/schema/<area>.ts`, run `pnpm db:generate`, commit the generated SQL
  under `packages/db/drizzle/`. Never edit a committed migration; add a new one.
- Money is always integer minor units (cents) plus a 3-letter currency. Never use floats for amounts.
- Every mutation in the API writes an `activity_log` row via `activityLog()`.
- Secrets at rest go through `encrypt()`/`decrypt()` from `@provisia/module-sdk`.
- No raw SQL string interpolation; use the Drizzle query builder (the `sql` tag with parameters is fine).

## Commits

Write clear, imperative commit messages ("Add invoice PDF renderer"). Keep unrelated changes in separate commits.

## License

By contributing you agree that your contributions are licensed under the AGPL-3.0, the same license as the project.

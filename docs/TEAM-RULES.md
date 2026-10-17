# Team rules for parallel feature agents (wave 1)

Nine agents work in this repo concurrently on branch `main`. To avoid conflicts:

1. **Read first**: docs/ARCHITECTURE.md and docs/FOUNDATION.md. Follow them exactly.
2. **Ownership**: only create/edit files in the directories you own (listed in your brief) plus your own
   `packages/db/src/schema/<feature>.ts`, `packages/shared/src/<feature>.ts`, `apps/api/src/modules/<feature>/`,
   `apps/worker/src/jobs/<feature>.ts`. Never rewrite or reformat someone else's file.
3. **Shared index files** (`packages/db/src/schema/index.ts`, `packages/shared/src/index.ts`, `apps/api/src/modules/index.ts`,
   `apps/worker/src/jobs/index.ts`, `apps/api/src/modules/registry.ts`, nav link lists in web layouts): re-read the file
   immediately before editing, make a single minimal line insertion with the Edit tool, never a full rewrite.
4. **Migrations**: do NOT run `drizzle-kit generate` (numbering would collide). Only add/modify your schema file. For
   testing, create your own database (`createdb -h localhost -U provisia provisia_<feature>` or via psql in the podman
   postgres) and use `pnpm --filter @provisia/db exec drizzle-kit push` with `DATABASE_URL` pointing at it.
   The coordinator generates one migration after the wave.
5. **Dependencies**: add with `pnpm add <pkg> --filter <workspace>`. If pnpm fails on a lockfile lock, wait 10s and retry.
   Never delete node_modules or run `pnpm install --force`.
6. **Verification**: run `pnpm --filter <your packages> typecheck/test/lint`, not the whole repo. If a repo-wide run fails in
   files you do not own, that is another agent's in-progress work: do not fix it, mention it in your report.
7. **Git**: do NOT commit. Do not run `git add`, `git stash`, `git checkout`, or anything that changes the index or
   working tree beyond your own files. The coordinator commits per area after the wave.
8. **Infra**: the dev stack is running (`podman compose -f deploy/compose.dev.yml`): postgres on localhost:5432
   (user/password/db `provisia`), valkey on 6379, mailpit SMTP 1025 / UI 8025. Do not restart or tear it down.
9. **Tests**: every module ships vitest unit tests; external APIs are tested with recorded/mocked HTTP (msw or nock),
   never live credentials. Put sandbox instructions in a README in your package.
10. **Report**: finish with a concise report: what was built, file paths, how to test, open issues, any contract deviations.

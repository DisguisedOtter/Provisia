## Summary

<!-- What does this change and why? Link the issue: Closes #123 -->

## Type

- [ ] feat / fix / perf / refactor / docs / build / ci / chore (commit messages follow Conventional Commits)
- [ ] Contains a database migration (`packages/db/drizzle/*.sql` generated with `pnpm db:generate`)
- [ ] Breaking change (documented in the PR and in `CHANGELOG.md`)

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally
- [ ] Follows `docs/ARCHITECTURE.md` (money as integer cents, `activity_log` on every mutation, zod schemas in `packages/shared`)
- [ ] New env vars are documented in `docs/CONFIGURATION.md` and `deploy/quadlets/provisia.env.example`
- [ ] New module: tests use recorded/mocked HTTP, sandbox instructions in the package README, registered in `apps/api/src/modules/registry.ts`
- [ ] Docs updated (`docs/`, `README.md`) where behaviour changed

## How to test

<!-- Commands, URLs, screenshots for UI changes -->

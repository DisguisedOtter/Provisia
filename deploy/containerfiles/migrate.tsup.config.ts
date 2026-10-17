/**
 * Bundles the migration runner and the seed from packages/db into packages/db/dist so the
 * one-shot `provisia-migrate` image can run them with plain `node` (no tsx, no TypeScript sources).
 * Paths are relative to apps/api because tsup is invoked through that workspace (it owns the tsup dev dep):
 *   pnpm --filter @provisia/api exec tsup --config ../../deploy/containerfiles/migrate.tsup.config.ts
 * `migrate.ts` locates the SQL files via `new URL('../drizzle', import.meta.url)`, which from
 * packages/db/dist/migrate.js resolves to packages/db/drizzle, exactly as in the source tree.
 */
// Plain object (no `import { defineConfig } from 'tsup'`): the file lives outside any workspace, so it cannot resolve tsup itself.
export default {
  entry: {
    migrate: '../../packages/db/src/migrate.ts',
    seed: '../../packages/db/src/seed.ts',
  },
  outDir: '../../packages/db/dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: [/^@provisia\//],
  skipNodeModulesBundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
};

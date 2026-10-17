import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: [/^@provisia\//],
  skipNodeModulesBundle: true,
  sourcemap: true,
  clean: true,
});

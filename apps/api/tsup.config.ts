import { defineConfig } from 'tsup';

// Bundles the app and the workspace packages (which ship TypeScript source) into dist/index.js.
// Everything from node_modules (including transitive deps of those packages) stays external.
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

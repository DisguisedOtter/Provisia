import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Loads the nearest `.env` found walking up from `cwd` (normally the repo root) into `process.env`.
 * Existing variables are never overridden, so container/CI env always wins. Node-only; import from
 * `@provisia/shared/env`, never from the package index (which is also bundled for the browser).
 */
export function loadEnv(cwd: string = process.cwd()): string | undefined {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

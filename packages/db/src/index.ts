import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export { schema };
export * from './schema/index.js';
export { uuidv7 } from './uuid.js';

export type Db = ReturnType<typeof createDb>['db'];
export type DbClient = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle instance backed by a postgres-js pool.
 * Call `close()` on shutdown so the process can exit.
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

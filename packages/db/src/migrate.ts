import { fileURLToPath } from 'node:url';
import { loadEnv } from '@provisia/shared/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies all pending migrations in ./drizzle. Safe to call repeatedly. */
export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  runMigrations(url)
    .then(() => console.log('migrations applied'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

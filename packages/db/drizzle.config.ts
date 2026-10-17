import { loadEnv } from '@provisia/shared/env';
import { defineConfig } from 'drizzle-kit';

loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://provisia:provisia@localhost:5432/provisia',
  },
  strict: true,
  verbose: true,
});

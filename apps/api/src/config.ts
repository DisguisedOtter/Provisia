import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  APP_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'APP_KEY must be 64 hex characters (openssl rand -hex 32)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  APP_URL: z.url().default('http://localhost:3001'),
  WEB_URL: z.url().default('http://localhost:3000'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Parses process.env (call `loadEnv()` first in entrypoints). Throws with a readable message. */
export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const result = envSchema.safeParse({ ...process.env, ...overrides });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return result.data;
}

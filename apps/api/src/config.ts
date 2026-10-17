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
  /**
   * Which upstream proxies to trust for X-Forwarded-For (drives rate limits, lockouts and audit IPs):
   * a hop count (`1` = the reverse proxy in front of the API), a CIDR/IP list, or `false`.
   * Default: `1` in production (Caddy), `false` otherwise.
   */
  TRUST_PROXY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

const PLACEHOLDER = /replace-with|change-?me|example|secret|password|changeit|todo/i;

/** `true` for the sample values from .env.example / provisia.env.example and other low-entropy strings. */
export function isWeakSecret(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  const distinct = new Set(value.toLowerCase()).size;
  if (distinct < 8) return true; // "0000…", "aaaa…", "1234123412…"
  return /^(.{1,4})\1+$/.test(value); // short repeated pattern
}

/**
 * Production refuses the documented placeholders and trivially guessable secrets: a predictable
 * SESSION_SECRET forges any session, a predictable APP_KEY decrypts every stored credential.
 */
function assertProductionSecrets(cfg: AppConfig): void {
  if (cfg.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (isWeakSecret(cfg.APP_KEY)) problems.push('APP_KEY: placeholder or low-entropy value');
  if (isWeakSecret(cfg.SESSION_SECRET))
    problems.push('SESSION_SECRET: placeholder or low-entropy value');
  if (problems.length) {
    throw new Error(
      `Refusing to start in production with weak secrets (generate with: openssl rand -hex 32):\n  ${problems.join('\n  ')}`,
    );
  }
}

/** Parses process.env (call `loadEnv()` first in entrypoints). Throws with a readable message. */
export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const result = envSchema.safeParse({ ...process.env, ...overrides });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  assertProductionSecrets(result.data);
  return result.data;
}

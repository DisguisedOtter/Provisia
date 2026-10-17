import { VERSION } from '@provisia/core';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from './schemas.js';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(app: FastifyInstance): Promise<HealthResponse> {
  const [database, redis] = await Promise.all([
    withTimeout(app.db.execute(sql`select 1`), 2000).then(
      () => 'ok' as const,
      () => 'error' as const,
    ),
    withTimeout(app.redis.ping(), 2000).then(
      () => 'ok' as const,
      () => 'error' as const,
    ),
  ]);
  return {
    status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
    version: VERSION,
    uptime: Math.round(process.uptime()),
    checks: { database, redis },
  };
}

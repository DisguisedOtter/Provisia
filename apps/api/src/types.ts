import type { Db, DbClient } from '@provisia/db';
import type { ModuleRegistry } from '@provisia/module-sdk';
import type { AuthUser } from '@provisia/shared';
import type { Redis } from 'ioredis';
import type { AppConfig } from './config.js';

export interface AuthContext {
  user: AuthUser;
  via: 'session' | 'api_key';
  /** Set when `via === 'session'`. */
  sessionId?: string;
  /** Set when `via === 'api_key'`. */
  apiKeyId?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    dbClient: DbClient;
    redis: Redis;
    modules: ModuleRegistry;
  }
  interface FastifyRequest {
    /** Resolved by the auth plugin on every request; null when anonymous. */
    auth: AuthContext | null;
  }
}

import type { Db, DbClient } from '@provisia/db';
import type { ModuleRegistry } from '@provisia/module-sdk';
import type { AuthUser } from '@provisia/shared';
import type { Redis } from 'ioredis';
import type { AppConfig } from './config.js';
import type { AppError } from './lib/errors.js';

export interface AuthContext {
  user: AuthUser;
  via: 'session' | 'api_key';
  /** Set when `via === 'session'`. */
  sessionId?: string;
  /** Set when `via === 'api_key'`. */
  apiKeyId?: string;
  /** Scopes of the API key (permission patterns); `['*']` means everything the user may do. */
  apiKeyScopes?: string[];
  /** Set on impersonation sessions ("login as client"): the admin's user id. */
  impersonatorUserId?: string;
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
    /** Set by `activityLog()`; the admin auto-audit hook skips requests that logged explicitly. */
    activityLogged?: boolean;
    /** Auth failure recorded in onRequest and thrown in preValidation, after rate limiting. */
    authError?: AppError | null;
  }
}

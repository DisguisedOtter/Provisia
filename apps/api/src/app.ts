import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import { registerModules } from './modules/index.js';
import { loadModules } from './modules/registry.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import redisPlugin from './plugins/redis.js';
import securityPlugin from './plugins/security.js';
import swaggerPlugin from './plugins/swagger.js';

export interface BuildAppOptions {
  config: AppConfig;
  logger?: boolean;
}

/** `TRUST_PROXY`: `false`, a hop count or a comma separated IP/CIDR list. */
export function parseTrustProxy(
  raw: string | undefined,
  env: string,
): boolean | string | ((address: string, hop: number) => boolean) {
  // Production: exactly the reverse proxy. Tests spoof X-Forwarded-For to isolate rate-limit buckets.
  const v = raw?.trim() || (env === 'production' ? '1' : env === 'test' ? 'true' : 'false');
  if (v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    return (_address, hop) => hop < hops;
  }
  return v;
}

export async function buildApp({
  config,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const dev = config.NODE_ENV === 'development';
  const app = Fastify({
    logger: logger && {
      level: config.LOG_LEVEL ?? (dev ? 'debug' : 'info'),
      transport: dev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: {
        // Single-use tokens travel in query strings (verify-email, reset-password): never log them.
        req(req: { method: string; url: string; host: string; ip: string }) {
          return {
            method: req.method,
            url: req.url.split('?')[0],
            host: req.host,
            remoteAddress: req.ip,
          };
        },
      },
    },
    trustProxy: parseTrustProxy(config.TRUST_PROXY, config.NODE_ENV),
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  app.decorate('modules', loadModules());

  await app.register(errorHandlerPlugin);
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(securityPlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await registerModules(app);

  return app;
}

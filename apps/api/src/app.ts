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
    },
    trustProxy: true,
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

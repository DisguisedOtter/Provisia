import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

export default fp(
  async (app) => {
    await app.register(helmet, {
      // Swagger UI needs inline scripts/styles; the API itself serves JSON only.
      contentSecurityPolicy: app.config.NODE_ENV === 'production' ? undefined : false,
    });
    await app.register(cors, {
      origin: [app.config.WEB_URL, app.config.APP_URL],
      credentials: true,
    });
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, ctx) =>
        new AppError('rate_limited', `Rate limit exceeded, retry in ${ctx.after}`, 429),
    });
  },
  { name: 'security' },
);

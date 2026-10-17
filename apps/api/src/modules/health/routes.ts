import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { healthResponseSchema } from './schemas.js';
import { getHealth } from './service.js';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/public/health',
    {
      schema: {
        tags: ['public'],
        summary: 'Liveness/readiness check',
        security: [],
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_req, reply) => {
      const health = await getHealth(app);
      return reply.status(health.checks.database === 'ok' ? 200 : 503).send(health);
    },
  );
};

export default routes;

import type { FastifyInstance } from 'fastify';
import authRoutes from './auth/routes.js';
import healthRoutes from './health/routes.js';

/**
 * Every feature module's routes plugin is registered here with one line, under /api/v1.
 * Route paths inside a module are relative: `/admin/clients`, `/portal/invoices`, `/public/...`.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes);
    },
    { prefix: '/api/v1' },
  );
}

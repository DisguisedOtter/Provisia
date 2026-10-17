import type { FastifyInstance } from 'fastify';
import activityRoutes from './activity/routes.js';
import authRoutes from './auth/routes.js';
import automationRoutes from './automation/routes.js';
import clientsRoutes from './clients/routes.js';
import dashboardRoutes from './dashboard/routes.js';
import domainsRoutes from './domains/routes.js';
import emailRoutes from './email/routes.js';
import healthRoutes from './health/routes.js';
import invoicesRoutes from './invoices/routes.js';
import modulesRoutes from './modules/routes.js';
import ordersRoutes from './orders/routes.js';
import paymentsRoutes from './payments/routes.js';
import productsRoutes from './products/routes.js';
import provisioningRoutes from './provisioning/routes.js';
import serversRoutes from './servers/routes.js';
import servicesRoutes from './services/routes.js';
import settingsRoutes from './settings/routes.js';
import ticketsRoutes from './tickets/routes.js';
import usersRoutes from './users/routes.js';

/**
 * Every feature module's routes plugin is registered here with one line, under /api/v1.
 * Route paths inside a module are relative: `/admin/clients`, `/portal/invoices`, `/public/...`.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes);
      await v1.register(usersRoutes);
      await v1.register(settingsRoutes);
      await v1.register(modulesRoutes);
      await v1.register(activityRoutes);
      await v1.register(automationRoutes);
      await v1.register(clientsRoutes);
      await v1.register(productsRoutes);
      await v1.register(servicesRoutes);
      await v1.register(invoicesRoutes);
      await v1.register(ordersRoutes);
      await v1.register(domainsRoutes);
      await v1.register(serversRoutes);
      await v1.register(provisioningRoutes);
      await v1.register(ticketsRoutes);
      await v1.register(emailRoutes);
      await v1.register(paymentsRoutes);
      await v1.register(dashboardRoutes);
    },
    { prefix: '/api/v1' },
  );
}

import type { ProvisioningLoginUrl } from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog, redactSecrets } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import {
  dataSchema,
  extraParamsSchema,
  idParamsSchema,
  logQuerySchema,
  moduleExtraDescriptorSchema,
  paginatedSchema,
  portalProvisioningInfoSchema,
  provisioningChangePackageBodySchema,
  provisioningChangePasswordBodySchema,
  provisioningCreateBodySchema,
  provisioningExtraBodySchema,
  provisioningLoginUrlSchema,
  provisioningLogSchema,
  provisioningPowerBodySchema,
  provisioningSuspendBodySchema,
  queuedJobSchema,
  serviceUsageSchema,
} from './schemas.js';
import {
  adminChangePackage,
  adminChangePassword,
  adminCreate,
  adminPower,
  adminSuspend,
  adminSyncUsage,
  adminTerminate,
  adminUnsuspend,
  enqueueAction,
  getUsage,
  listExtras,
  listLog,
  loadOwnedService,
  loadServiceWithProduct,
  portalInfo,
} from './service.js';
import { runProvisioningJobAndWait } from './wait.js';

const TAG = ['provisioning'];
const queued = { 202: dataSchema(queuedJobSchema) };

const routes: FastifyPluginAsyncZod = async (app) => {
  const actor = (req: { auth: { user: { id: string } } | null }) => ({
    registry: app.modules,
    actorUserId: req.auth?.user.id ?? '',
  });

  /* ---------------------------------------------------------------- admin actions (enqueue jobs) */
  app.post(
    '/admin/services/:id/provision/create',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        summary: 'Provision the service now (picks a server when none is set)',
        params: idParamsSchema,
        body: provisioningCreateBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const job = await adminCreate(app.db, actor(req), req.params.id, req.body.serverId);
      await activityLog(req, {
        action: 'service.provision.create',
        entityType: 'service',
        entityId: req.params.id,
        diff: { job },
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/suspend',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        params: idParamsSchema,
        body: provisioningSuspendBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const job = await adminSuspend(app.db, actor(req), req.params.id, req.body.reason);
      await activityLog(req, {
        action: 'service.provision.suspend',
        entityType: 'service',
        entityId: req.params.id,
        diff: { reason: req.body.reason ?? null },
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/unsuspend',
    {
      preHandler: requirePermission('services.write'),
      schema: { tags: TAG, params: idParamsSchema, response: queued },
    },
    async (req, reply) => {
      const job = await adminUnsuspend(app.db, actor(req), req.params.id);
      await activityLog(req, {
        action: 'service.provision.unsuspend',
        entityType: 'service',
        entityId: req.params.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/terminate',
    {
      preHandler: requirePermission('services.write'),
      schema: { tags: TAG, params: idParamsSchema, response: queued },
    },
    async (req, reply) => {
      const job = await adminTerminate(app.db, actor(req), req.params.id);
      await activityLog(req, {
        action: 'service.provision.terminate',
        entityType: 'service',
        entityId: req.params.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/change-package',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        summary: 'Apply the new product package on the panel (billing switches the product/price)',
        params: idParamsSchema,
        body: provisioningChangePackageBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const job = await adminChangePackage(app.db, actor(req), req.params.id, req.body.productId);
      await activityLog(req, {
        action: 'service.provision.changePackage',
        entityType: 'service',
        entityId: req.params.id,
        diff: { productId: req.body.productId },
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/change-password',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        params: idParamsSchema,
        body: provisioningChangePasswordBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const job = await adminChangePassword(app.db, actor(req), req.params.id, req.body.password);
      await activityLog(req, {
        action: 'service.provision.changePassword',
        entityType: 'service',
        entityId: req.params.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/sync-usage',
    {
      preHandler: requirePermission('services.write'),
      schema: { tags: TAG, params: idParamsSchema, response: queued },
    },
    async (req, reply) => {
      const job = await adminSyncUsage(app.db, actor(req), req.params.id);
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/services/:id/provision/power',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        params: idParamsSchema,
        body: provisioningPowerBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const job = await adminPower(app.db, actor(req), req.params.id, req.body.action);
      await activityLog(req, {
        action: `service.provision.power.${req.body.action}`,
        entityType: 'service',
        entityId: req.params.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  /* ---------------------------------------------------------------- module specific actions */
  app.get(
    '/admin/services/:id/extras',
    {
      preHandler: requirePermission('services.read'),
      schema: {
        tags: TAG,
        summary: 'Module specific actions available for this service',
        params: idParamsSchema,
        response: { 200: dataSchema(z.array(moduleExtraDescriptorSchema)) },
      },
    },
    async (req) => {
      const { product } = await loadServiceWithProduct(app.db, req.params.id);
      return { data: listExtras(app.modules, product, 'staff') };
    },
  );

  app.post(
    '/admin/services/:id/extras/:action',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        summary:
          'Run a module specific action (console URL, rDNS, firewall, backups, reinstall, ...)',
        params: extraParamsSchema,
        body: provisioningExtraBodySchema,
        response: { 200: dataSchema(z.unknown()) },
      },
    },
    async (req) => {
      const { service, product } = await loadServiceWithProduct(app.db, req.params.id);
      const action = listExtras(app.modules, product, 'staff').find(
        (a) => a.id === req.params.action,
      );
      if (!action)
        throw badRequest(`Action ${req.params.action} is not available for this service`);
      const result = await runProvisioningJobAndWait('extra', {
        serviceId: service.id,
        action: action.id,
        params: req.body.params,
        audience: 'staff',
        actorUserId: req.auth?.user.id,
      });
      if (!action.readOnly) {
        await activityLog(req, {
          action: `service.extra.${action.id}`,
          entityType: 'service',
          entityId: service.id,
          diff: { params: redactSecrets(req.body.params) },
        });
      }
      return { data: result ?? null };
    },
  );

  app.get(
    '/admin/services/:id/provisioning-log',
    {
      preHandler: requirePermission('services.read'),
      schema: {
        tags: TAG,
        params: idParamsSchema,
        querystring: logQuerySchema,
        response: { 200: paginatedSchema(provisioningLogSchema) },
      },
    },
    async (req) => listLog(app.db, req.params.id, req.query),
  );

  app.get(
    '/admin/services/:id/usage',
    {
      preHandler: requirePermission('services.read'),
      schema: {
        tags: TAG,
        params: idParamsSchema,
        response: { 200: dataSchema(serviceUsageSchema.nullable()) },
      },
    },
    async (req) => ({ data: await getUsage(app.db, req.params.id) }),
  );

  /* ---------------------------------------------------------------- portal */
  app.get(
    '/portal/services/:id/provisioning',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        summary: 'Panel capabilities + username/IP for the client',
        params: idParamsSchema,
        response: { 200: dataSchema(portalProvisioningInfoSchema) },
      },
    },
    async (req) => {
      const { service, product } = await loadOwnedService(
        app.db,
        req.params.id,
        req.auth?.user.clientId,
      );
      return { data: await portalInfo(app.db, app.modules, service, product) };
    },
  );

  app.get(
    '/portal/services/:id/usage',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        params: idParamsSchema,
        response: { 200: dataSchema(serviceUsageSchema.nullable()) },
      },
    },
    async (req) => {
      await loadOwnedService(app.db, req.params.id, req.auth?.user.clientId);
      return { data: await getUsage(app.db, req.params.id) };
    },
  );

  app.post(
    '/portal/services/:id/login',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: TAG,
        summary: 'One-time SSO link into the control panel (worker call, awaited)',
        params: idParamsSchema,
        response: { 200: dataSchema(provisioningLoginUrlSchema) },
      },
    },
    async (req) => {
      const { service } = await loadOwnedService(app.db, req.params.id, req.auth?.user.clientId);
      if (service.status !== 'active') throw badRequest('Service is not active');
      const result = await runProvisioningJobAndWait<'loginUrl', { url: string }>(
        'loginUrl',
        { serviceId: service.id, actorUserId: req.auth?.user.id },
        { timeoutMs: 30_000 },
      );
      await activityLog(req, {
        action: 'service.panelLogin',
        entityType: 'service',
        entityId: service.id,
      });
      const data: ProvisioningLoginUrl = { url: result.url, expiresIn: 300 };
      return { data };
    },
  );

  app.post(
    '/portal/services/:id/reset-password',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        tags: TAG,
        summary: 'Generate a new panel password (emailed / shown by the worker flow)',
        params: idParamsSchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const { service, product } = await loadOwnedService(
        app.db,
        req.params.id,
        req.auth?.user.clientId,
      );
      const mod = product.module ? app.modules.find('provisioner', product.module) : undefined;
      if (!mod?.changePassword)
        throw badRequest('Password reset is not available for this service');
      if (service.status !== 'active') throw badRequest('Service is not active');
      const job = await enqueueAction('changePassword', {
        serviceId: service.id,
        actorUserId: req.auth?.user.id,
      });
      await activityLog(req, {
        action: 'service.resetPassword',
        entityType: 'service',
        entityId: service.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/portal/services/:id/power',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: TAG,
        summary: 'VPS power action (Proxmox): start / stop / shutdown / reboot',
        params: idParamsSchema,
        body: provisioningPowerBodySchema,
        response: queued,
      },
    },
    async (req, reply) => {
      const { service, product } = await loadOwnedService(
        app.db,
        req.params.id,
        req.auth?.user.clientId,
      );
      const mod = product.module ? app.modules.find('provisioner', product.module) : undefined;
      if (!mod?.power) throw badRequest('Power control is not available for this service');
      if (service.status !== 'active') throw badRequest('Service is not active');
      // One in-flight power job per service: BullMQ dedupes on jobId while the previous one is queued/active.
      const job = await enqueueAction('power', {
        serviceId: service.id,
        action: req.body.action,
        actorUserId: req.auth?.user.id,
      });
      await activityLog(req, {
        action: `service.power.${req.body.action}`,
        entityType: 'service',
        entityId: service.id,
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.get(
    '/portal/services/:id/extras',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        summary: 'Module specific actions the client may run on this service',
        params: idParamsSchema,
        response: { 200: dataSchema(z.array(moduleExtraDescriptorSchema)) },
      },
    },
    async (req) => {
      const { product } = await loadOwnedService(app.db, req.params.id, req.auth?.user.clientId);
      return { data: listExtras(app.modules, product, 'client') };
    },
  );

  app.post(
    '/portal/services/:id/extras/:action',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: TAG,
        summary: 'Run a module specific action (console, rDNS, firewall, backups, reinstall, ...)',
        params: extraParamsSchema,
        body: provisioningExtraBodySchema,
        response: { 200: dataSchema(z.unknown()) },
      },
    },
    async (req) => {
      const { service, product } = await loadOwnedService(
        app.db,
        req.params.id,
        req.auth?.user.clientId,
      );
      const action = listExtras(app.modules, product, 'client').find(
        (a) => a.id === req.params.action,
      );
      if (!action)
        throw badRequest(`Action ${req.params.action} is not available for this service`);
      if (service.status !== 'active') throw badRequest('Service is not active');
      const result = await runProvisioningJobAndWait('extra', {
        serviceId: service.id,
        action: action.id,
        params: req.body.params,
        audience: 'client',
        actorUserId: req.auth?.user.id,
      });
      if (!action.readOnly) {
        await activityLog(req, {
          action: `service.extra.${action.id}`,
          entityType: 'service',
          entityId: service.id,
          diff: { params: redactSecrets(req.body.params) },
        });
      }
      return { data: result ?? null };
    },
  );

  app.get(
    '/portal/services/:id/provisioning-log',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        summary: 'Recent actions on the service (no internal details)',
        params: idParamsSchema,
        querystring: logQuerySchema,
        response: {
          200: paginatedSchema(provisioningLogSchema.omit({ details: true, actorUserId: true })),
        },
      },
    },
    async (req) => {
      await loadOwnedService(app.db, req.params.id, req.auth?.user.clientId);
      const page = await listLog(app.db, req.params.id, req.query);
      return { ...page, data: page.data.map(({ details: _d, actorUserId: _a, ...rest }) => rest) };
    },
  );
};

export default routes;

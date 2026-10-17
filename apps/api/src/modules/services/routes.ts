import { dataSchema, paginatedSchema } from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import { forbidden } from '../../lib/errors.js';
import {
  cancelServiceSchema,
  changeServicePackageResultSchema,
  changeServicePackageSchema,
  createServiceSchema,
  serviceIdParams,
  serviceListQuerySchema,
  serviceWithProductSchema,
  updateServiceSchema,
} from './schemas.js';
import {
  cancelService,
  changePackage,
  createService,
  deleteService,
  forClient,
  getService,
  listServices,
  updateService,
} from './service.js';

const TAG = ['services'];

function clientIdOf(req: { auth: { user: { clientId: string | null } } | null }): string {
  const id = req.auth?.user.clientId;
  if (!id) throw forbidden('No client account linked to this user');
  return id;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ admin
  app.get(
    '/admin/services',
    {
      preHandler: requirePermission('services.read'),
      schema: {
        tags: TAG,
        querystring: serviceListQuerySchema,
        response: { 200: paginatedSchema(serviceWithProductSchema) },
      },
    },
    async (req) => listServices(app.db, req.query),
  );

  app.get(
    '/admin/services/:id',
    {
      preHandler: requirePermission('services.read'),
      schema: {
        tags: TAG,
        params: serviceIdParams,
        response: { 200: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req) => ({ data: await getService(app.db, req.params.id) }),
  );

  app.post(
    '/admin/services',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        body: createServiceSchema,
        response: { 201: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req, reply) => {
      const service = await createService(app.db, req.body);
      await activityLog(req, {
        action: 'service.create',
        entityType: 'service',
        entityId: service.id,
      });
      return reply.status(201).send({ data: service });
    },
  );

  app.patch(
    '/admin/services/:id',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        params: serviceIdParams,
        body: updateServiceSchema,
        response: { 200: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req) => {
      const before = await getService(app.db, req.params.id);
      const service = await updateService(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'service.update',
        entityType: 'service',
        entityId: service.id,
        diff: {
          before: { status: before.status, nextDueDate: before.nextDueDate },
          after: req.body,
        },
      });
      return { data: service };
    },
  );

  app.delete(
    '/admin/services/:id',
    {
      preHandler: requirePermission('services.write'),
      schema: { tags: TAG, params: serviceIdParams, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteService(app.db, req.params.id);
      await activityLog(req, {
        action: 'service.delete',
        entityType: 'service',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/admin/services/:id/change-package',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        summary: 'Upgrade/downgrade with proration to the next due date',
        params: serviceIdParams,
        body: changeServicePackageSchema,
        response: { 200: dataSchema(changeServicePackageResultSchema) },
      },
    },
    async (req) => {
      const result = await changePackage(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'service.change_package',
        entityType: 'service',
        entityId: req.params.id,
        diff: {
          productId: req.body.productId,
          billingCycle: req.body.billingCycle ?? null,
          net: result.proration.net,
          invoiceId: result.invoiceId,
        },
      });
      return { data: result };
    },
  );

  app.post(
    '/admin/services/:id/cancel',
    {
      preHandler: requirePermission('services.write'),
      schema: {
        tags: TAG,
        params: serviceIdParams,
        body: cancelServiceSchema,
        response: { 200: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req) => {
      const service = await cancelService(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'service.cancel',
        entityType: 'service',
        entityId: service.id,
        diff: req.body,
      });
      return { data: service };
    },
  );

  // ------------------------------------------------------------------ portal
  app.get(
    '/portal/services',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        querystring: serviceListQuerySchema,
        response: { 200: paginatedSchema(serviceWithProductSchema) },
      },
    },
    async (req) => {
      const page = await listServices(app.db, req.query, clientIdOf(req));
      return { ...page, data: page.data.map(forClient) };
    },
  );

  app.get(
    '/portal/services/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        params: serviceIdParams,
        response: { 200: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req) => ({ data: forClient(await getService(app.db, req.params.id, clientIdOf(req))) }),
  );

  app.post(
    '/portal/services/:id/cancel',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        params: serviceIdParams,
        body: cancelServiceSchema,
        response: { 200: dataSchema(serviceWithProductSchema) },
      },
    },
    async (req) => {
      const service = await cancelService(app.db, req.params.id, req.body, clientIdOf(req));
      await activityLog(req, {
        action: 'service.cancel',
        entityType: 'service',
        entityId: service.id,
        diff: req.body,
      });
      return { data: forClient(service) };
    },
  );
};

export default routes;

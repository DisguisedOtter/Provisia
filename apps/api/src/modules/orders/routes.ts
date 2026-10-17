import { dataSchema, paginatedSchema } from '@provisia/shared';
import { enqueue } from '@provisia/worker/queues';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import {
  cartQuoteSchema,
  createOrderSchema,
  guestQuoteRequestSchema,
  guestQuoteSchema,
  orderAcceptResultSchema,
  orderCancelSchema,
  orderIdParams,
  orderListQuerySchema,
  orderQuoteRequestSchema,
  orderWithItemsSchema,
} from './schemas.js';
import {
  acceptOrder,
  closeOrder,
  createOrder,
  getOrder,
  listOrders,
  quoteCart,
  quoteGuestCart,
} from './service.js';

const TAG = ['orders'];

function clientIdOf(req: { auth: { user: { clientId: string | null } } | null }): string {
  const id = req.auth?.user.clientId;
  if (!id) throw forbidden('No client account linked to this user');
  return id;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ admin
  app.get(
    '/admin/orders',
    {
      preHandler: requirePermission('orders.read'),
      schema: {
        tags: TAG,
        querystring: orderListQuerySchema,
        response: { 200: paginatedSchema(orderWithItemsSchema) },
      },
    },
    async (req) => listOrders(app.db, req.query),
  );

  app.get(
    '/admin/orders/:id',
    {
      preHandler: requirePermission('orders.read'),
      schema: {
        tags: TAG,
        params: orderIdParams,
        response: { 200: dataSchema(orderWithItemsSchema) },
      },
    },
    async (req) => ({ data: await getOrder(app.db, req.params.id) }),
  );

  app.post(
    '/admin/orders/quote',
    {
      preHandler: requirePermission('orders.write'),
      schema: {
        tags: TAG,
        summary: 'Price a cart for a client',
        body: orderQuoteRequestSchema,
        response: { 200: dataSchema(cartQuoteSchema) },
      },
    },
    async (req) => {
      if (!req.body.clientId) throw badRequest('clientId is required');
      return { data: await quoteCart(app.db, req.body.clientId, req.body.items) };
    },
  );

  app.post(
    '/admin/orders',
    {
      preHandler: requirePermission('orders.write'),
      schema: {
        tags: TAG,
        body: createOrderSchema,
        response: { 201: dataSchema(orderWithItemsSchema) },
      },
    },
    async (req, reply) => {
      if (!req.body.clientId) throw badRequest('clientId is required');
      const order = await createOrder(app.db, {
        ...req.body,
        clientId: req.body.clientId,
        ip: req.ip,
      });
      await activityLog(req, {
        action: 'order.create',
        entityType: 'order',
        entityId: order.id,
        diff: { number: order.number, total: order.total },
      });
      return reply.status(201).send({ data: order });
    },
  );

  app.post(
    '/admin/orders/:id/accept',
    {
      preHandler: requirePermission('orders.write'),
      schema: {
        tags: TAG,
        summary: 'Accept: creates pending services/domains and issues the invoice',
        params: orderIdParams,
        response: { 200: dataSchema(orderAcceptResultSchema) },
      },
    },
    async (req) => {
      const { result, settled, domainJobs } = await acceptOrder(app.db, req.params.id);
      await activityLog(req, {
        action: 'order.accept',
        entityType: 'order',
        entityId: result.id,
        diff: { invoiceId: result.invoice?.id ?? null },
      });
      // TODO provisioning:create is enqueued by the invoices module on payment.
      if (settled) {
        for (const j of domainJobs) {
          await enqueue(
            'domains',
            j.name,
            { domainId: j.domainId },
            { jobId: `domains-${j.name}-${j.domainId}` },
          ).catch((err) => req.log.warn({ err }, 'failed to enqueue domain job'));
        }
      }
      return { data: result };
    },
  );

  for (const status of ['cancelled', 'fraud'] as const) {
    app.post(
      `/admin/orders/:id/${status === 'cancelled' ? 'cancel' : 'fraud'}`,
      {
        preHandler: requirePermission('orders.write'),
        schema: {
          tags: TAG,
          params: orderIdParams,
          body: orderCancelSchema.nullish(),
          response: { 200: dataSchema(orderWithItemsSchema) },
        },
      },
      async (req) => {
        const order = await closeOrder(app.db, req.params.id, status);
        await activityLog(req, {
          action: `order.${status}`,
          entityType: 'order',
          entityId: order.id,
          diff: { reason: req.body?.reason ?? null },
        });
        return { data: order };
      },
    );
  }

  // ------------------------------------------------------------------ portal
  app.get(
    '/portal/orders',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        querystring: orderListQuerySchema,
        response: { 200: paginatedSchema(orderWithItemsSchema) },
      },
    },
    async (req) => listOrders(app.db, req.query, clientIdOf(req)),
  );

  app.get(
    '/portal/orders/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        params: orderIdParams,
        response: { 200: dataSchema(orderWithItemsSchema) },
      },
    },
    async (req) => ({ data: await getOrder(app.db, req.params.id, clientIdOf(req)) }),
  );

  app.post(
    '/public/orders/quote',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: TAG,
        summary: 'Storefront cart quote for visitors (tax from country / VAT number)',
        security: [],
        body: guestQuoteRequestSchema,
        response: { 200: dataSchema(guestQuoteSchema) },
      },
    },
    async (req) => ({
      data: {
        ...(await quoteGuestCart(app.db, req.body, req.body.items)),
        promoValid: req.body.promoCode ? false : null,
      },
    }),
  );

  app.post(
    '/portal/orders/quote',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        body: orderQuoteRequestSchema.omit({ clientId: true }),
        response: { 200: dataSchema(cartQuoteSchema) },
      },
    },
    async (req) => ({ data: await quoteCart(app.db, clientIdOf(req), req.body.items) }),
  );

  app.post(
    '/portal/orders',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        body: createOrderSchema.omit({ clientId: true }),
        response: { 201: dataSchema(orderWithItemsSchema) },
      },
    },
    async (req, reply) => {
      const order = await createOrder(app.db, {
        ...req.body,
        clientId: clientIdOf(req),
        ip: req.ip,
      });
      await activityLog(req, {
        action: 'order.create',
        entityType: 'order',
        entityId: order.id,
        diff: { number: order.number, total: order.total },
      });
      return reply.status(201).send({ data: order });
    },
  );

  app.post(
    '/portal/orders/:id/cancel',
    {
      preHandler: requireClient,
      schema: {
        tags: TAG,
        params: orderIdParams,
        body: orderCancelSchema.nullish(),
        response: { 200: dataSchema(orderWithItemsSchema) },
      },
    },
    async (req) => {
      const order = await closeOrder(app.db, req.params.id, 'cancelled', clientIdOf(req));
      await activityLog(req, {
        action: 'order.cancelled',
        entityType: 'order',
        entityId: order.id,
        diff: { reason: req.body?.reason ?? null },
      });
      return { data: order };
    },
  );
};

export default routes;

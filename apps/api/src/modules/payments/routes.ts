import type { RawRequest } from '@provisia/module-sdk';
import type { EmailSendJob } from '@provisia/shared';
import { enqueue } from '@provisia/worker/queues';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requireStaff } from '../../lib/auth.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { GatewayError, resolveGateway } from './gateways.js';
import { applyWebhookResult, processWebhook, type WebhookDeps } from './ledger.js';
import {
  addPaymentMethodSchema,
  autoPaySettingsSchema,
  clientIdParamsSchema,
  configureGatewaySchema,
  dataSchema,
  gatewayParamsSchema,
  idParamsSchema,
  paginatedSchema,
  payInvoiceSchema,
  paymentGatewaySchema,
  paymentIntentListQuerySchema,
  paymentIntentSchema,
  paymentMethodSchema,
  paymentStartSchema,
  paymentWebhookEventSchema,
  portalGatewaySchema,
  refundRequestSchema,
  refundResponseSchema,
  setupStartSchema,
  testCredentialsResultSchema,
  webhookAckSchema,
  webhookEventListQuerySchema,
} from './schemas.js';
import {
  configureGateway,
  type Deps,
  enableGateway,
  getAutoPay,
  listClientMethods,
  listGateways,
  listPaymentIntents,
  listWebhookEvents,
  portalGateways,
  refundTransaction,
  removeSavedMethod,
  setAutoPay,
  startInvoicePayment,
  startSavedMethodSetup,
  testGateway,
} from './service.js';

const emailSink = (job: EmailSendJob) => enqueue('email', 'send', job);

export function paymentDeps(app: FastifyInstance, req?: FastifyRequest): WebhookDeps & Deps {
  return {
    db: app.db,
    modules: app.modules,
    appKey: app.config.APP_KEY,
    appUrl: app.config.APP_URL,
    webUrl: app.config.WEB_URL,
    logger: req?.log ?? app.log,
    emailSink,
  };
}

function clientIdOf(req: FastifyRequest): string {
  const id = req.auth?.user.clientId;
  if (!id) throw forbidden('No client account linked to this user');
  return id;
}

function toRawRequest(req: FastifyRequest): RawRequest {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '');
  const contentType = String(req.headers['content-type'] ?? '');
  let body: unknown;
  if (contentType.includes('json') && rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      body = undefined;
    }
  } else if (contentType.includes('x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
  }
  return {
    method: req.method,
    url: req.url,
    headers: req.headers as RawRequest['headers'],
    rawBody,
    body,
    query: (req.query ?? {}) as RawRequest['query'],
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  /* ---------------------------------------------------------------------------------------------
   * Public: webhooks (raw body) + browser returns
   * ------------------------------------------------------------------------------------------- */
  await app.register(async (raw) => {
    const pub = raw.withTypeProvider<ZodTypeProvider>();
    // Encapsulated: every content type arrives as the exact bytes so signatures can be verified.
    pub.removeAllContentTypeParsers();
    pub.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    pub.post(
      '/public/webhooks/:gateway',
      {
        config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
        schema: {
          tags: ['payments'],
          summary: 'Gateway webhook endpoint (signature verified by the gateway module)',
          security: [],
          params: gatewayParamsSchema,
          response: { 200: webhookAckSchema },
        },
      },
      async (req, reply) => {
        const deps = paymentDeps(app, req);
        try {
          const outcome = await processWebhook(deps, req.params.gateway, toRawRequest(req));
          return reply.send({
            received: true,
            status: outcome.status,
            kind: outcome.kind,
          });
        } catch (err) {
          if (err instanceof GatewayError) {
            // Unknown / unconfigured gateway: tell the sender to stop retrying.
            throw new AppError(
              err.code,
              err.message,
              err.status === 409 ? 404 : err.status,
              err.details,
            );
          }
          const name = err instanceof Error ? err.name : '';
          if (/SignatureError|WebhookError/.test(name)) {
            req.log.warn({ err, gateway: req.params.gateway }, 'payments: webhook rejected');
            throw new AppError(
              'invalid_signature',
              err instanceof Error ? err.message : 'invalid webhook',
              400,
            );
          }
          // Anything else is ours (DB, gateway API down): 500 so the gateway redelivers.
          req.log.error(
            { err, gateway: req.params.gateway },
            'payments: webhook processing failed',
          );
          throw err;
        }
      },
    );
  });

  app.get(
    '/public/payments/:gateway/return',
    {
      schema: {
        tags: ['payments'],
        summary: 'Browser return from a gateway that needs a server-side capture (PayPal)',
        security: [],
        params: gatewayParamsSchema,
        querystring: z.record(z.string(), z.string()),
      },
    },
    async (req, reply) => {
      const deps = paymentDeps(app, req);
      const fallback = `${app.config.WEB_URL.replace(/\/$/, '')}/portal/invoices?payment=error`;
      try {
        const { gateway, ctx } = await resolveGateway(deps, req.params.gateway, {
          requireEnabled: false,
        });
        if (!gateway.handleReturn) return reply.redirect(fallback);
        const ret = await gateway.handleReturn(ctx, toRawRequest(req));
        if (ret.result) await applyWebhookResult(deps, gateway, ret.result, 'return');
        return reply.redirect(ret.redirectUrl);
      } catch (err) {
        req.log.error({ err, gateway: req.params.gateway }, 'payments: return handling failed');
        return reply.redirect(fallback);
      }
    },
  );

  /* ---------------------------------------------------------------------------------------------
   * Portal
   * ------------------------------------------------------------------------------------------- */
  app.get(
    '/portal/payments/gateways',
    {
      preHandler: requireClient,
      schema: {
        tags: ['payments'],
        summary: 'Enabled gateways',
        response: { 200: dataSchema(z.array(portalGatewaySchema)) },
      },
    },
    async (req) => ({ data: await portalGateways(paymentDeps(app, req)) }),
  );

  app.post(
    '/portal/invoices/:id/pay',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['payments'],
        summary: 'Start paying an invoice; returns a redirect URL or client secret',
        params: idParamsSchema,
        body: payInvoiceSchema,
        response: { 200: dataSchema(paymentStartSchema) },
      },
    },
    async (req) => {
      const clientId = clientIdOf(req);
      const start = await startInvoicePayment(
        paymentDeps(app, req),
        clientId,
        req.params.id,
        req.body.gateway,
      );
      await activityLog(req, {
        action: 'invoice.payment_start',
        entityType: 'invoice',
        entityId: req.params.id,
        diff: { gateway: start.gateway, txnId: start.txnId },
      });
      return { data: start };
    },
  );

  app.get(
    '/portal/payments/methods',
    {
      preHandler: requireClient,
      schema: {
        tags: ['payments'],
        summary: 'Saved payment methods',
        response: { 200: dataSchema(z.array(paymentMethodSchema)) },
      },
    },
    async (req) => ({ data: await listClientMethods(app.db, clientIdOf(req)) }),
  );

  app.post(
    '/portal/payments/methods',
    {
      preHandler: requireClient,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['payments'],
        summary: 'Start saving a payment method (redirect / client secret)',
        body: addPaymentMethodSchema,
        response: { 200: dataSchema(setupStartSchema) },
      },
    },
    async (req) => {
      const clientId = clientIdOf(req);
      const start = await startSavedMethodSetup(paymentDeps(app, req), clientId, req.body.gateway);
      await activityLog(req, {
        action: 'payment_method.setup_start',
        entityType: 'client',
        entityId: clientId,
        diff: { gateway: start.gateway, setupId: start.setupId },
      });
      return { data: start };
    },
  );

  app.delete(
    '/portal/payments/methods/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: ['payments'],
        summary: 'Remove a saved payment method',
        params: idParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const clientId = clientIdOf(req);
      await removeSavedMethod(paymentDeps(app, req), req.params.id, clientId);
      await activityLog(req, {
        action: 'payment_method.remove',
        entityType: 'client',
        entityId: clientId,
        diff: { methodId: req.params.id },
      });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/portal/payments/autopay',
    {
      preHandler: requireClient,
      schema: {
        tags: ['payments'],
        summary: 'Auto-pay settings',
        response: { 200: dataSchema(autoPaySettingsSchema) },
      },
    },
    async (req) => ({ data: await getAutoPay(app.db, clientIdOf(req)) }),
  );

  app.put(
    '/portal/payments/autopay',
    {
      preHandler: requireClient,
      schema: {
        tags: ['payments'],
        summary: 'Enable/disable auto-pay and pick the method',
        body: autoPaySettingsSchema,
        response: { 200: dataSchema(autoPaySettingsSchema) },
      },
    },
    async (req) => {
      const clientId = clientIdOf(req);
      const before = await getAutoPay(app.db, clientId);
      const after = await setAutoPay(app.db, clientId, req.body);
      await activityLog(req, {
        action: 'client.autopay_update',
        entityType: 'client',
        entityId: clientId,
        diff: { before, after },
      });
      return { data: after };
    },
  );

  /* ---------------------------------------------------------------------------------------------
   * Admin
   * ------------------------------------------------------------------------------------------- */
  app.get(
    '/admin/payments/gateways',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Installed gateways with (masked) configuration',
        response: { 200: dataSchema(z.array(paymentGatewaySchema)) },
      },
    },
    async (req) => ({ data: await listGateways(paymentDeps(app, req)) }),
  );

  app.put(
    '/admin/payments/gateways/:gateway',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Store gateway configuration (encrypted); masked secrets keep their value',
        params: gatewayParamsSchema,
        body: configureGatewaySchema,
        response: { 200: dataSchema(paymentGatewaySchema) },
      },
    },
    async (req) => {
      const info = await configureGateway(paymentDeps(app, req), req.params.gateway, req.body);
      await activityLog(req, {
        action: 'payment_gateway.configure',
        entityType: 'payment_gateway',
        diff: {
          gateway: req.params.gateway,
          keys: Object.keys(req.body.config),
          enabled: info.enabled,
        },
      });
      return { data: info };
    },
  );

  for (const action of ['enable', 'disable'] as const) {
    app.post(
      `/admin/payments/gateways/:gateway/${action}`,
      {
        preHandler: requireStaff,
        schema: {
          tags: ['payments'],
          summary: `${action === 'enable' ? 'Enable' : 'Disable'} a gateway`,
          params: gatewayParamsSchema,
          response: { 200: dataSchema(paymentGatewaySchema) },
        },
      },
      async (req) => {
        const info = await enableGateway(
          paymentDeps(app, req),
          req.params.gateway,
          action === 'enable',
        );
        await activityLog(req, {
          action: `payment_gateway.${action}`,
          entityType: 'payment_gateway',
          diff: { gateway: req.params.gateway },
        });
        return { data: info };
      },
    );
  }

  app.post(
    '/admin/payments/gateways/:gateway/test',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Test the stored credentials',
        params: gatewayParamsSchema,
        response: { 200: dataSchema(testCredentialsResultSchema) },
      },
    },
    async (req) => ({ data: await testGateway(paymentDeps(app, req), req.params.gateway) }),
  );

  app.post(
    '/admin/payments/transactions/:id/refund',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Refund a gateway payment (full or partial)',
        params: idParamsSchema,
        body: refundRequestSchema,
        response: { 200: dataSchema(refundResponseSchema) },
      },
    },
    async (req) => {
      const result = await refundTransaction(paymentDeps(app, req), req.params.id, req.body);
      await activityLog(req, {
        action: 'transaction.refund',
        entityType: 'transaction',
        entityId: req.params.id,
        diff: { ...result, reason: req.body.reason ?? null },
      });
      return { data: result };
    },
  );

  app.get(
    '/admin/payments/clients/:clientId/methods',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: "A client's saved payment methods",
        params: clientIdParamsSchema,
        response: { 200: dataSchema(z.array(paymentMethodSchema)) },
      },
    },
    async (req) => ({ data: await listClientMethods(app.db, req.params.clientId) }),
  );

  app.delete(
    '/admin/payments/methods/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Revoke a saved payment method',
        params: idParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await removeSavedMethod(paymentDeps(app, req), req.params.id);
      await activityLog(req, {
        action: 'payment_method.remove',
        entityType: 'payment_method',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/admin/payments/webhook-events',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Inbound webhook log',
        querystring: webhookEventListQuerySchema,
        response: { 200: paginatedSchema(paymentWebhookEventSchema) },
      },
    },
    async (req) => listWebhookEvents(app.db, req.query),
  );

  app.get(
    '/admin/payments/intents',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['payments'],
        summary: 'Payments started at gateways (pending / succeeded / failed)',
        querystring: paymentIntentListQuerySchema,
        response: { 200: paginatedSchema(paymentIntentSchema) },
      },
    },
    async (req) => listPaymentIntents(app.db, req.query),
  );
};

export default routes;

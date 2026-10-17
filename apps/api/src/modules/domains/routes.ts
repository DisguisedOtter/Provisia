import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requireStaff } from '../../lib/auth.js';
import { forbidden } from '../../lib/errors.js';
import {
  adminUpdateDomainSchema,
  alertListQuerySchema,
  availabilityQuerySchema,
  availabilityResponseSchema,
  contactListQuerySchema,
  createDomainContactHandleSchema,
  createTldSchema,
  dataSchema,
  domainActionResponseSchema,
  domainAlertSchema,
  domainContactHandleSchema,
  domainListQuerySchema,
  domainSchema,
  domainSyncLogSchema,
  eppCodeResponseSchema,
  idParamsSchema,
  importTldPricingSchema,
  jobResponseSchema,
  moduleParamsSchema,
  paginatedSchema,
  paginationQuerySchema,
  portalDomainSchema,
  updateDomainSchema as portalUpdateDomainSchema,
  publicTldSchema,
  registerDomainRequestSchema,
  registrarAccountSchema,
  registrarModuleInfoSchema,
  renewDomainRequestSchema,
  setStatusSchema,
  tldListQuerySchema,
  tldWithPricesSchema,
  transferDomainRequestSchema,
  updateDomainContactHandleSchema,
  updateDomainSchema,
  updateTldSchema,
  upsertRegistrarAccountSchema,
} from './schemas.js';
import {
  acknowledgeAlert,
  changeRegistrar,
  checkAvailability,
  createContactHandle,
  createTld,
  deleteContactHandle,
  deleteRegistrarAccount,
  deleteTld,
  getDomain,
  getRegistrarAccount,
  getTld,
  listAlerts,
  listContactHandles,
  listDomains,
  listPublicTlds,
  listRegistrarModules,
  listSyncLog,
  listTlds,
  requestEppCode,
  requestPricingImport,
  requestSync,
  setDomainStatus,
  startRegistration,
  startRenewal,
  startTransfer,
  updateContactHandle,
  updateDomain,
  updateTld,
  upsertRegistrarAccount,
} from './service.js';

const TAG_ADMIN = 'domains (admin)';
const TAG_PORTAL = 'domains (portal)';
const TAG_PUBLIC = 'domains (public)';

function clientIdOf(req: { auth: { user: { clientId?: string | null } } | null }): string {
  const id = req.auth?.user.clientId;
  if (!id) throw forbidden('No client account linked to this user');
  return id;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const appKey = app.config.APP_KEY;
  const availabilityDeps = () => ({
    db: app.db,
    modules: app.modules,
    redis: app.redis,
    appKey,
    appUrl: app.config.APP_URL,
    webUrl: app.config.WEB_URL,
    logger: app.log,
  });

  // -------------------------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------------------------

  app.get(
    '/public/domains/availability',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: [TAG_PUBLIC],
        summary: 'Check availability of a domain (and suggestions on other configured TLDs)',
        description:
          'Results are cached for `ttl` seconds; clients should debounce input (>= 400 ms) and send the full name once the user pauses.',
        security: [],
        querystring: availabilityQuerySchema,
        response: { 200: availabilityResponseSchema },
      },
    },
    async (req) => ({ data: await checkAvailability(availabilityDeps(), req.query) }),
  );

  app.get(
    '/public/tlds',
    {
      schema: {
        tags: [TAG_PUBLIC],
        summary: 'Sellable TLDs with prices',
        security: [],
        response: { 200: dataSchema(z.array(publicTldSchema)) },
      },
    },
    async () => ({ data: await listPublicTlds(app.db) }),
  );

  // -------------------------------------------------------------------------------------------
  // Admin: registrar accounts
  // -------------------------------------------------------------------------------------------

  app.get(
    '/admin/registrars',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Installed registrar modules and whether they are configured',
        response: { 200: dataSchema(z.array(registrarModuleInfoSchema)) },
      },
    },
    async () => ({ data: await listRegistrarModules(app.db, app.modules) }),
  );

  app.get(
    '/admin/registrars/:module',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: moduleParamsSchema,
        response: { 200: dataSchema(registrarAccountSchema) },
      },
    },
    async (req) => ({
      data: await getRegistrarAccount(app.db, app.modules, req.params.module, appKey),
    }),
  );

  app.put(
    '/admin/registrars/:module',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary:
          'Create or update a registrar account (config is validated against the module schema and encrypted)',
        params: moduleParamsSchema,
        body: upsertRegistrarAccountSchema,
        response: { 200: dataSchema(registrarAccountSchema) },
      },
    },
    async (req) => {
      const account = await upsertRegistrarAccount(
        app.db,
        app.modules,
        req.params.module,
        req.body,
        appKey,
      );
      await activityLog(req, {
        action: 'registrar.configure',
        entityType: 'registrar_account',
        entityId: account.id,
        diff: {
          module: account.module,
          enabled: account.enabled,
          keys: Object.keys(req.body.config),
        },
      });
      return { data: account };
    },
  );

  app.delete(
    '/admin/registrars/:module',
    {
      preHandler: requireStaff,
      schema: { tags: [TAG_ADMIN], params: moduleParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteRegistrarAccount(app.db, req.params.module);
      await activityLog(req, {
        action: 'registrar.delete',
        entityType: 'registrar_account',
        diff: { module: req.params.module },
      });
      return reply.status(204).send(null);
    },
  );

  // -------------------------------------------------------------------------------------------
  // Admin: TLD catalog
  // -------------------------------------------------------------------------------------------

  app.get(
    '/admin/tlds',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        querystring: paginationQuerySchema.extend(tldListQuerySchema.shape),
        response: { 200: paginatedSchema(tldWithPricesSchema) },
      },
    },
    async (req) => {
      const { page, perPage, ...filter } = req.query;
      return listTlds(app.db, filter, { page, perPage });
    },
  );

  app.post(
    '/admin/tlds',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        body: createTldSchema,
        response: { 201: dataSchema(tldWithPricesSchema) },
      },
    },
    async (req, reply) => {
      const tld = await createTld(app.db, req.body);
      await activityLog(req, {
        action: 'tld.create',
        entityType: 'tld',
        entityId: tld.id,
        diff: { tld: tld.tld },
      });
      return reply.status(201).send({ data: tld });
    },
  );

  app.post(
    '/admin/tlds/import-pricing',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary:
          'Import TLD cost prices from a registrar (runs as worker job domains:importPricing)',
        body: importTldPricingSchema,
        response: { 202: jobResponseSchema },
      },
    },
    async (req, reply) => {
      const job = await requestPricingImport(app.db, app.modules, req.body);
      await activityLog(req, {
        action: 'tld.import_pricing',
        entityType: 'tld',
        diff: { ...req.body, jobId: job.id },
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.get(
    '/admin/tlds/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        response: { 200: dataSchema(tldWithPricesSchema) },
      },
    },
    async (req) => ({ data: await getTld(app.db, req.params.id) }),
  );

  app.patch(
    '/admin/tlds/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        body: updateTldSchema,
        response: { 200: dataSchema(tldWithPricesSchema) },
      },
    },
    async (req) => {
      const tld = await updateTld(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'tld.update',
        entityType: 'tld',
        entityId: tld.id,
        diff: { after: req.body },
      });
      return { data: tld };
    },
  );

  app.delete(
    '/admin/tlds/:id',
    {
      preHandler: requireStaff,
      schema: { tags: [TAG_ADMIN], params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteTld(app.db, req.params.id);
      await activityLog(req, { action: 'tld.delete', entityType: 'tld', entityId: req.params.id });
      return reply.status(204).send(null);
    },
  );

  // -------------------------------------------------------------------------------------------
  // Admin: domains
  // -------------------------------------------------------------------------------------------

  app.get(
    '/admin/domains',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        querystring: paginationQuerySchema.extend(domainListQuerySchema.shape),
        response: { 200: paginatedSchema(domainSchema) },
      },
    },
    async (req) => {
      const { page, perPage, ...filter } = req.query;
      return listDomains(app.db, filter, { page, perPage });
    },
  );

  app.post(
    '/admin/domains/register',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary:
          'Create a domain and enqueue domains:register (no invoice; use orders for billed purchases)',
        body: registerDomainRequestSchema.required({ clientId: true }),
        response: { 202: domainActionResponseSchema },
      },
    },
    async (req, reply) => {
      const { domain, job } = await startRegistration(app.db, req.body, req.body.clientId);
      await activityLog(req, {
        action: 'domain.register',
        entityType: 'domain',
        entityId: domain.id,
        diff: { name: domain.name, years: req.body.years, jobId: job.id },
      });
      return reply.status(202).send({ data: domain, job });
    },
  );

  app.post(
    '/admin/domains/transfer',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Create a domain and enqueue domains:transfer',
        body: transferDomainRequestSchema.required({ clientId: true }),
        response: { 202: domainActionResponseSchema },
      },
    },
    async (req, reply) => {
      const { domain, job } = await startTransfer(app.db, req.body, req.body.clientId, appKey);
      await activityLog(req, {
        action: 'domain.transfer',
        entityType: 'domain',
        entityId: domain.id,
        diff: { name: domain.name, jobId: job.id },
      });
      return reply.status(202).send({ data: domain, job });
    },
  );

  app.get(
    '/admin/domains/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        response: { 200: dataSchema(domainSchema) },
      },
    },
    async (req) => ({ data: await getDomain(app.db, req.params.id) }),
  );

  app.patch(
    '/admin/domains/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary:
          'Update a domain; nameserver/contact/lock changes are pushed to the registrar by domains:sync',
        params: idParamsSchema,
        body: adminUpdateDomainSchema,
        response: {
          200: dataSchema(domainSchema).extend({ job: jobResponseSchema.shape.data.nullable() }),
        },
      },
    },
    async (req) => {
      const { domain, job, diff } = await updateDomain(
        app.db,
        app.modules,
        req.params.id,
        req.body,
        { admin: true },
      );
      if (Object.keys(diff).length) {
        await activityLog(req, {
          action: 'domain.update',
          entityType: 'domain',
          entityId: domain.id,
          diff,
        });
      }
      return { data: domain, job };
    },
  );

  app.post(
    '/admin/domains/:id/status',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Mark a domain status manually (transition checked unless force)',
        params: idParamsSchema,
        body: setStatusSchema,
        response: { 200: dataSchema(domainSchema) },
      },
    },
    async (req) => {
      const before = await getDomain(app.db, req.params.id);
      const domain = await setDomainStatus(app.db, req.params.id, req.body.status, req.body);
      await activityLog(req, {
        action: 'domain.set_status',
        entityType: 'domain',
        entityId: domain.id,
        diff: { before: before.status, after: domain.status, reason: req.body.reason },
      });
      return { data: domain };
    },
  );

  app.post(
    '/admin/domains/:id/registrar',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Change the registrar module of a domain (resets moduleData)',
        params: idParamsSchema,
        body: z.object({ registrarModule: z.string().max(50).nullable() }),
        response: { 200: dataSchema(domainSchema) },
      },
    },
    async (req) => {
      const before = await getDomain(app.db, req.params.id);
      const domain = await changeRegistrar(
        app.db,
        app.modules,
        req.params.id,
        req.body.registrarModule,
      );
      await activityLog(req, {
        action: 'domain.change_registrar',
        entityType: 'domain',
        entityId: domain.id,
        diff: { before: before.registrarModule, after: domain.registrarModule },
      });
      return { data: domain };
    },
  );

  app.post(
    '/admin/domains/:id/renew',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        body: renewDomainRequestSchema,
        response: { 202: domainActionResponseSchema },
      },
    },
    async (req, reply) => {
      const { domain, job } = await startRenewal(app.db, req.params.id, req.body.years);
      await activityLog(req, {
        action: 'domain.renew',
        entityType: 'domain',
        entityId: domain.id,
        diff: { years: req.body.years, jobId: job.id },
      });
      return reply.status(202).send({ data: domain, job });
    },
  );

  app.post(
    '/admin/domains/:id/sync',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Enqueue a manual domains:sync',
        params: idParamsSchema,
        response: { 202: jobResponseSchema },
      },
    },
    async (req, reply) => {
      const job = await requestSync(app.db, req.params.id);
      await activityLog(req, {
        action: 'domain.sync',
        entityType: 'domain',
        entityId: req.params.id,
        diff: { jobId: job.id },
      });
      return reply.status(202).send({ data: job });
    },
  );

  app.post(
    '/admin/domains/:id/epp-code',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        response: { 200: eppCodeResponseSchema },
      },
    },
    async (req) => {
      const data = await requestEppCode(app.db, req.params.id, { appKey });
      await activityLog(req, {
        action: 'domain.epp_code',
        entityType: 'domain',
        entityId: req.params.id,
        diff: { served: data.eppCode !== null },
      });
      return { data };
    },
  );

  app.get(
    '/admin/domains/:id/sync-log',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(domainSyncLogSchema) },
      },
    },
    async (req) => listSyncLog(app.db, req.params.id, req.query),
  );

  app.get(
    '/admin/domain-alerts',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        summary: 'Admin notifications raised by the domain worker',
        querystring: paginationQuerySchema.extend(alertListQuerySchema.shape),
        response: { 200: paginatedSchema(domainAlertSchema) },
      },
    },
    async (req) => {
      const { page, perPage, ...filter } = req.query;
      return listAlerts(app.db, filter, { page, perPage });
    },
  );

  app.post(
    '/admin/domain-alerts/:id/acknowledge',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        response: { 200: dataSchema(domainAlertSchema) },
      },
    },
    async (req) => {
      if (!req.auth) throw forbidden();
      const alert = await acknowledgeAlert(app.db, req.params.id, req.auth.user.id);
      await activityLog(req, {
        action: 'domain_alert.acknowledge',
        entityType: 'domain_alert',
        entityId: alert.id,
      });
      return { data: alert };
    },
  );

  // -------------------------------------------------------------------------------------------
  // Admin: contact handles
  // -------------------------------------------------------------------------------------------

  app.get(
    '/admin/domain-contacts',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        querystring: contactListQuerySchema,
        response: { 200: dataSchema(z.array(domainContactHandleSchema)) },
      },
    },
    async (req) => ({ data: await listContactHandles(app.db, req.query.clientId) }),
  );

  app.post(
    '/admin/domain-contacts',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        body: createDomainContactHandleSchema.required({ clientId: true }),
        response: { 201: dataSchema(domainContactHandleSchema) },
      },
    },
    async (req, reply) => {
      const { clientId, ...input } = req.body;
      const contact = await createContactHandle(app.db, clientId, input);
      await activityLog(req, {
        action: 'domain_contact.create',
        entityType: 'domain_contact',
        entityId: contact.id,
      });
      return reply.status(201).send({ data: contact });
    },
  );

  app.patch(
    '/admin/domain-contacts/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: [TAG_ADMIN],
        params: idParamsSchema,
        body: updateDomainContactHandleSchema,
        response: { 200: dataSchema(domainContactHandleSchema) },
      },
    },
    async (req) => {
      const contact = await updateContactHandle(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'domain_contact.update',
        entityType: 'domain_contact',
        entityId: contact.id,
      });
      return { data: contact };
    },
  );

  app.delete(
    '/admin/domain-contacts/:id',
    {
      preHandler: requireStaff,
      schema: { tags: [TAG_ADMIN], params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteContactHandle(app.db, req.params.id);
      await activityLog(req, {
        action: 'domain_contact.delete',
        entityType: 'domain_contact',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  // -------------------------------------------------------------------------------------------
  // Portal
  // -------------------------------------------------------------------------------------------

  app.get(
    '/portal/domains',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        querystring: paginationQuerySchema.extend(
          domainListQuerySchema.omit({ clientId: true }).shape,
        ),
        response: { 200: paginatedSchema(portalDomainSchema) },
      },
    },
    async (req) => {
      const { page, perPage, ...filter } = req.query;
      return listDomains(app.db, { ...filter, clientId: clientIdOf(req) }, { page, perPage });
    },
  );

  app.get(
    '/portal/domains/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        params: idParamsSchema,
        response: { 200: dataSchema(portalDomainSchema) },
      },
    },
    async (req) => ({ data: await getDomain(app.db, req.params.id, clientIdOf(req)) }),
  );

  app.patch(
    '/portal/domains/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        summary: 'Nameservers, auto-renew, lock, ID protection, contacts',
        params: idParamsSchema,
        body: portalUpdateDomainSchema,
        response: {
          200: dataSchema(portalDomainSchema).extend({
            job: jobResponseSchema.shape.data.nullable(),
          }),
        },
      },
    },
    async (req) => {
      const { domain, job, diff } = await updateDomain(
        app.db,
        app.modules,
        req.params.id,
        updateDomainSchema.parse(req.body),
        { clientId: clientIdOf(req) },
      );
      if (Object.keys(diff).length) {
        await activityLog(req, {
          action: 'domain.update',
          entityType: 'domain',
          entityId: domain.id,
          diff,
        });
      }
      return { data: domain, job };
    },
  );

  app.post(
    '/portal/domains/:id/renew',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        summary:
          'Request a renewal (enqueues domains:renew; billing happens through auto-renew / orders)',
        params: idParamsSchema,
        body: renewDomainRequestSchema,
        response: { 202: domainActionResponseSchema },
      },
    },
    async (req, reply) => {
      const { domain, job } = await startRenewal(app.db, req.params.id, req.body.years, {
        clientId: clientIdOf(req),
      });
      await activityLog(req, {
        action: 'domain.renew',
        entityType: 'domain',
        entityId: domain.id,
        diff: { years: req.body.years, jobId: job.id },
      });
      return reply.status(202).send({ data: domain, job });
    },
  );

  app.post(
    '/portal/domains/:id/epp-code',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        params: idParamsSchema,
        response: { 200: eppCodeResponseSchema },
      },
    },
    async (req) => {
      const data = await requestEppCode(app.db, req.params.id, {
        clientId: clientIdOf(req),
        appKey,
      });
      await activityLog(req, {
        action: 'domain.epp_code',
        entityType: 'domain',
        entityId: req.params.id,
        diff: { served: data.eppCode !== null },
      });
      return { data };
    },
  );

  app.get(
    '/portal/domain-contacts',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        response: { 200: dataSchema(z.array(domainContactHandleSchema)) },
      },
    },
    async (req) => ({ data: await listContactHandles(app.db, clientIdOf(req)) }),
  );

  app.post(
    '/portal/domain-contacts',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        body: createDomainContactHandleSchema.omit({ clientId: true }),
        response: { 201: dataSchema(domainContactHandleSchema) },
      },
    },
    async (req, reply) => {
      const contact = await createContactHandle(app.db, clientIdOf(req), req.body);
      await activityLog(req, {
        action: 'domain_contact.create',
        entityType: 'domain_contact',
        entityId: contact.id,
      });
      return reply.status(201).send({ data: contact });
    },
  );

  app.patch(
    '/portal/domain-contacts/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: [TAG_PORTAL],
        params: idParamsSchema,
        body: updateDomainContactHandleSchema,
        response: { 200: dataSchema(domainContactHandleSchema) },
      },
    },
    async (req) => {
      const contact = await updateContactHandle(app.db, req.params.id, req.body, clientIdOf(req));
      await activityLog(req, {
        action: 'domain_contact.update',
        entityType: 'domain_contact',
        entityId: contact.id,
      });
      return { data: contact };
    },
  );

  app.delete(
    '/portal/domain-contacts/:id',
    {
      preHandler: requireClient,
      schema: { tags: [TAG_PORTAL], params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteContactHandle(app.db, req.params.id, clientIdOf(req));
      await activityLog(req, {
        action: 'domain_contact.delete',
        entityType: 'domain_contact',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;
export { activateDomainOrderItem, createDomainOrderItem } from './order-item.js';

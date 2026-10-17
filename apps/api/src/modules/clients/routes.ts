import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import { forbidden } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import {
  clientContactSchema,
  clientIdParams,
  clientListQuerySchema,
  clientWithUserSchema,
  contactParams,
  createClientContactSchema,
  createClientSchema,
  creditAdjustmentResultSchema,
  creditAdjustmentSchema,
  dataSchema,
  paginatedSchema,
  paginationQuerySchema,
  transactionSchema,
  updateClientContactSchema,
  updateClientSchema,
  updatePortalProfileSchema,
  vatValidateBody,
  vatValidationResultSchema,
} from './schemas.js';
import {
  closeClient,
  createClient,
  createContact,
  creditAdjustment,
  deleteContact,
  getClient,
  listClients,
  listClientTransactions,
  listContacts,
  updateClient,
  updateContact,
  updatePortalProfile,
  validateVat,
} from './service.js';
import { getViesClient } from './vies.js';

const TAG = ['clients'];
const createClientResponse = dataSchema(
  clientWithUserSchema.extend({ generatedPassword: z.string().nullable() }),
);
const vatResponse = dataSchema(
  vatValidationResultSchema.extend({ cached: z.boolean(), reason: z.string().nullable() }),
);

function ownClientId(req: { auth: { user: { clientId: string | null } } | null }): string {
  const id = req.auth?.user.clientId;
  if (!id) throw forbidden('No client account linked to this user');
  return id;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- admin: clients
  app.get(
    '/admin/clients',
    {
      preHandler: requirePermission('clients.read'),
      schema: {
        tags: TAG,
        summary: 'List clients',
        querystring: clientListQuerySchema,
        response: { 200: paginatedSchema(clientWithUserSchema) },
      },
    },
    async (req) => listClients(app.db, req.query),
  );

  app.post(
    '/admin/clients',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Create a client (and its login user)',
        body: createClientSchema,
        response: { 201: createClientResponse },
      },
    },
    async (req, reply) => {
      const { client, generatedPassword } = await createClient(app.db, req.body);
      await activityLog(req, {
        action: 'client.create',
        entityType: 'client',
        entityId: client.id,
      });
      return reply.status(201).send({ data: { ...client, generatedPassword } });
    },
  );

  app.get(
    '/admin/clients/:id',
    {
      preHandler: requirePermission('clients.read'),
      schema: {
        tags: TAG,
        summary: 'Get a client',
        params: clientIdParams,
        response: { 200: dataSchema(clientWithUserSchema) },
      },
    },
    async (req) => ({ data: await getClient(app.db, req.params.id) }),
  );

  app.patch(
    '/admin/clients/:id',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Update a client',
        params: clientIdParams,
        body: updateClientSchema,
        response: { 200: dataSchema(clientWithUserSchema) },
      },
    },
    async (req) => {
      const { before, after } = await updateClient(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'client.update',
        entityType: 'client',
        entityId: after.id,
        diff: { before: pick(before, req.body), after: pick(after, req.body) },
      });
      return { data: after };
    },
  );

  app.delete(
    '/admin/clients/:id',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Close a client (soft delete)',
        params: clientIdParams,
        response: { 200: dataSchema(clientWithUserSchema) },
      },
    },
    async (req) => {
      const client = await closeClient(app.db, req.params.id);
      await activityLog(req, { action: 'client.close', entityType: 'client', entityId: client.id });
      return { data: client };
    },
  );

  // ---------------------------------------------------------------- admin: contacts
  app.get(
    '/admin/clients/:id/contacts',
    {
      preHandler: requirePermission('clients.read'),
      schema: {
        tags: TAG,
        summary: 'List client contacts',
        params: clientIdParams,
        response: { 200: dataSchema(z.array(clientContactSchema)) },
      },
    },
    async (req) => ({ data: await listContacts(app.db, req.params.id) }),
  );

  app.post(
    '/admin/clients/:id/contacts',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Add a contact',
        params: clientIdParams,
        body: createClientContactSchema,
        response: { 201: dataSchema(clientContactSchema) },
      },
    },
    async (req, reply) => {
      const contact = await createContact(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'client.contact.create',
        entityType: 'client_contact',
        entityId: contact.id,
        diff: { clientId: req.params.id },
      });
      return reply.status(201).send({ data: contact });
    },
  );

  app.patch(
    '/admin/clients/:id/contacts/:contactId',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Update a contact',
        params: contactParams,
        body: updateClientContactSchema,
        response: { 200: dataSchema(clientContactSchema) },
      },
    },
    async (req) => {
      const contact = await updateContact(app.db, req.params.id, req.params.contactId, req.body);
      await activityLog(req, {
        action: 'client.contact.update',
        entityType: 'client_contact',
        entityId: contact.id,
        diff: { patch: req.body },
      });
      return { data: contact };
    },
  );

  app.delete(
    '/admin/clients/:id/contacts/:contactId',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Delete a contact',
        params: contactParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await deleteContact(app.db, req.params.id, req.params.contactId);
      await activityLog(req, {
        action: 'client.contact.delete',
        entityType: 'client_contact',
        entityId: req.params.contactId,
        diff: { clientId: req.params.id },
      });
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- admin: credit / transactions / VAT
  app.post(
    '/admin/clients/:id/credit',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Adjust the credit balance (negative = deduct)',
        params: clientIdParams,
        body: creditAdjustmentSchema,
        response: { 201: dataSchema(creditAdjustmentResultSchema) },
      },
    },
    async (req, reply) => {
      const result = await creditAdjustment(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'client.credit.adjust',
        entityType: 'client',
        entityId: req.params.id,
        diff: {
          amount: req.body.amount,
          description: req.body.description,
          creditBalance: result.creditBalance,
        },
      });
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    '/admin/clients/:id/transactions',
    {
      preHandler: requirePermission('clients.read'),
      schema: {
        tags: TAG,
        summary: 'Client transactions',
        params: clientIdParams,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(transactionSchema) },
      },
    },
    async (req) => {
      await getClient(app.db, req.params.id);
      return listClientTransactions(app.db, req.params.id, req.query);
    },
  );

  app.post(
    '/admin/clients/:id/vat/validate',
    {
      preHandler: requirePermission('clients.write'),
      schema: {
        tags: TAG,
        summary: 'Validate the VAT number against VIES (cached on the client)',
        params: clientIdParams,
        body: vatValidateBody,
        response: { 200: vatResponse },
      },
    },
    async (req) => {
      const tax = await getSettings(app.db, 'tax');
      const result = await validateVat(app.db, req.params.id, await getViesClient(app.db), {
        force: req.body?.force ?? false,
        cacheDays: tax.viesCacheDays,
      });
      await activityLog(req, {
        action: 'client.vat.validate',
        entityType: 'client',
        entityId: req.params.id,
        diff: { valid: result.valid, cached: result.cached, unavailable: result.unavailable },
      });
      return { data: result };
    },
  );

  // ---------------------------------------------------------------- portal
  app.get(
    '/portal/profile',
    {
      preHandler: requireClient,
      schema: {
        tags: ['portal'],
        summary: 'Own client profile',
        response: { 200: dataSchema(clientWithUserSchema) },
      },
    },
    async (req) => ({ data: await getClient(app.db, ownClientId(req)) }),
  );

  app.patch(
    '/portal/profile',
    {
      preHandler: requireClient,
      schema: {
        tags: ['portal'],
        summary: 'Update own profile',
        body: updatePortalProfileSchema,
        response: { 200: dataSchema(clientWithUserSchema) },
      },
    },
    async (req) => {
      const clientId = ownClientId(req);
      const { after } = await updatePortalProfile(app.db, clientId, req.body);
      await activityLog(req, {
        action: 'client.profile.update',
        entityType: 'client',
        entityId: clientId,
        diff: { patch: req.body },
      });
      return { data: after };
    },
  );

  app.get(
    '/portal/transactions',
    {
      preHandler: requireClient,
      schema: {
        tags: ['portal'],
        summary: 'Own transactions',
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(transactionSchema) },
      },
    },
    async (req) => listClientTransactions(app.db, ownClientId(req), req.query),
  );
};

function pick(
  obj: Record<string, unknown>,
  keys: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) out[k] = obj[k];
  return out;
}

export default routes;

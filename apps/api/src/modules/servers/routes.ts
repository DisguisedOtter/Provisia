import type { RemoteOption, TestConnectionResult } from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog, redactSecrets } from '../../lib/activity-log.js';
import { requireStaff } from '../../lib/auth.js';
import { runProvisioningJobAndWait } from '../provisioning/wait.js';
import {
  capacityResponseSchema,
  createServerGroupSchema,
  createServerSchema,
  dataSchema,
  idParamsSchema,
  optionsParamsSchema,
  optionsQuerySchema,
  paginatedSchema,
  provisionerDescriptorSchema,
  remoteOptionSchema,
  serverCapacitySchema,
  serverGroupSchema,
  serverListQuerySchema,
  testConnectionResultSchema,
  updateServerGroupSchema,
  updateServerSchema,
} from './schemas.js';
import {
  capacityOverview,
  createGroup,
  createServer,
  deleteGroup,
  deleteServer,
  getServer,
  listGroups,
  listProvisioners,
  listServers,
  updateGroup,
  updateServer,
} from './service.js';

const TAG = ['servers'];

const routes: FastifyPluginAsyncZod = async (app) => {
  /* ---------------------------------------------------------------- modules */
  app.get(
    '/admin/provisioners',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        summary: 'Installed provisioning modules with their config/credential JSON schemas',
        response: { 200: dataSchema(z.array(provisionerDescriptorSchema)) },
      },
    },
    async () => ({ data: listProvisioners(app.modules) }),
  );

  /* ---------------------------------------------------------------- servers */
  app.get(
    '/admin/servers',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        summary: 'List servers with capacity',
        querystring: serverListQuerySchema,
        response: { 200: paginatedSchema(serverCapacitySchema) },
      },
    },
    async (req) => listServers(app.db, req.query),
  );

  app.post(
    '/admin/servers',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        summary: 'Create a server (credentials validated by the module and encrypted)',
        body: createServerSchema,
        response: { 201: dataSchema(serverCapacitySchema) },
      },
    },
    async (req, reply) => {
      const server = await createServer(app.db, app.modules, req.body);
      await activityLog(req, {
        action: 'server.create',
        entityType: 'server',
        entityId: server.id,
        diff: { after: redactSecrets(req.body) },
      });
      return reply.status(201).send({ data: server });
    },
  );

  app.get(
    '/admin/servers/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        params: idParamsSchema,
        response: { 200: dataSchema(serverCapacitySchema) },
      },
    },
    async (req) => ({ data: await getServer(app.db, req.params.id) }),
  );

  app.patch(
    '/admin/servers/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        params: idParamsSchema,
        body: updateServerSchema,
        response: { 200: dataSchema(serverCapacitySchema) },
      },
    },
    async (req) => {
      const server = await updateServer(app.db, app.modules, req.params.id, req.body);
      await activityLog(req, {
        action: 'server.update',
        entityType: 'server',
        entityId: server.id,
        diff: { after: redactSecrets(req.body) },
      });
      return { data: server };
    },
  );

  app.delete(
    '/admin/servers/:id',
    {
      preHandler: requireStaff,
      schema: { tags: TAG, params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteServer(app.db, req.params.id);
      await activityLog(req, {
        action: 'server.delete',
        entityType: 'server',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/admin/servers/:id/test',
    {
      preHandler: requireStaff,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: TAG,
        summary: 'Run testConnection in the worker and wait for the result',
        params: idParamsSchema,
        response: { 200: dataSchema(testConnectionResultSchema) },
      },
    },
    async (req) => {
      await getServer(app.db, req.params.id);
      const result = await runProvisioningJobAndWait<'testConnection', TestConnectionResult>(
        'testConnection',
        { serverId: req.params.id, actorUserId: req.auth?.user.id },
        { timeoutMs: 45_000 },
      );
      await activityLog(req, {
        action: 'server.test',
        entityType: 'server',
        entityId: req.params.id,
        diff: { result },
      });
      return { data: result };
    },
  );

  app.get(
    '/admin/servers/:id/options/:kind',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        summary:
          'Discover packages / plans / templates / nodes / storages / bridges on the server (for product config dropdowns)',
        params: optionsParamsSchema,
        querystring: optionsQuerySchema,
        response: { 200: dataSchema(z.array(remoteOptionSchema)) },
      },
    },
    async (req) => {
      await getServer(app.db, req.params.id);
      const data = await runProvisioningJobAndWait<'discover', RemoteOption[]>(
        'discover',
        { serverId: req.params.id, kind: req.params.kind, config: req.query },
        { timeoutMs: 45_000 },
      );
      return { data };
    },
  );

  /* ---------------------------------------------------------------- groups */
  app.get(
    '/admin/server-groups',
    {
      preHandler: requireStaff,
      schema: { tags: TAG, response: { 200: dataSchema(z.array(serverGroupSchema)) } },
    },
    async () => ({ data: await listGroups(app.db) }),
  );

  app.get(
    '/admin/server-groups/capacity',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        summary: 'Capacity view: every group with its servers and account counts',
        response: { 200: capacityResponseSchema },
      },
    },
    async () => ({ data: await capacityOverview(app.db) }),
  );

  app.post(
    '/admin/server-groups',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        body: createServerGroupSchema,
        response: { 201: dataSchema(serverGroupSchema) },
      },
    },
    async (req, reply) => {
      const group = await createGroup(app.db, req.body);
      await activityLog(req, {
        action: 'server_group.create',
        entityType: 'server_group',
        entityId: group.id,
        diff: { after: req.body },
      });
      return reply.status(201).send({ data: group });
    },
  );

  app.patch(
    '/admin/server-groups/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: TAG,
        params: idParamsSchema,
        body: updateServerGroupSchema,
        response: { 200: dataSchema(serverGroupSchema) },
      },
    },
    async (req) => {
      const group = await updateGroup(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'server_group.update',
        entityType: 'server_group',
        entityId: group.id,
        diff: { after: req.body },
      });
      return { data: group };
    },
  );

  app.delete(
    '/admin/server-groups/:id',
    {
      preHandler: requireStaff,
      schema: { tags: TAG, params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteGroup(app.db, req.params.id);
      await activityLog(req, {
        action: 'server_group.delete',
        entityType: 'server_group',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;

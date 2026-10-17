import {
  apiKeySchema,
  createRoleSchema,
  createStaffUserSchema,
  dataSchema,
  inviteStaffUserSchema,
  paginate,
  paginatedSchema,
  paginationQuerySchema,
  permissionDescriptorSchema,
  roleSchema,
  staffListQuerySchema,
  staffUserSchema,
  updateRoleSchema,
  updateStaffUserSchema,
} from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog, entityDiff } from '../../lib/activity-log.js';
import { requirePermission } from '../../lib/auth.js';
import { LoginLockout } from '../../lib/auth-lockout.js';
import { hasPendingToken, issueToken } from '../../lib/auth-tokens.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { sendTemplateEmail } from '../../lib/mail.js';
import { revokeApiKey } from '../auth/service.js';
import {
  type Actor,
  createRole,
  createStaff,
  deleteRole,
  getRole,
  getStaff,
  listAllApiKeys,
  listPermissions,
  listRoles,
  listStaff,
  resetTwoFactor,
  setStaffActive,
  updateRole,
  updateStaff,
} from './service.js';

const idParams = z.object({ id: z.uuid() });
const okSchema = dataSchema(z.object({ ok: z.literal(true) }));
const adminApiKeySchema = apiKeySchema.extend({ userEmail: z.string() });

async function sendInvite(
  app: Parameters<FastifyPluginAsyncZod>[0],
  user: { id: string; email: string; firstName: string; lastName: string },
  inviterName: string,
) {
  const t = await issueToken(app.db, { userId: user.id, type: 'invite' });
  await sendTemplateEmail('auth.password_reset', {
    to: user.email,
    toUserId: user.id,
    data: {
      user: { email: user.email, firstName: user.firstName, lastName: user.lastName },
      actionUrl: `${app.config.WEB_URL}/reset-password?token=${encodeURIComponent(t.token)}&invite=1`,
      expiresIn: '7 days',
      ip: inviterName,
    },
  });
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const actorOf = (req: {
    auth: {
      user: { id: string; role: 'admin' | 'staff' | 'client'; permissions: string[] };
    } | null;
  }): Actor => {
    if (!req.auth) throw unauthorized();
    const { id, role, permissions } = req.auth.user;
    return { id, role, permissions };
  };

  // ------------------------------------------------------------ permissions + roles
  app.get(
    '/admin/permissions',
    {
      preHandler: requirePermission('users.read'),
      schema: {
        tags: ['users'],
        summary: 'All permission strings',
        response: { 200: dataSchema(z.array(permissionDescriptorSchema)) },
      },
    },
    async () => ({ data: listPermissions() }),
  );

  app.get(
    '/admin/roles',
    {
      preHandler: requirePermission('users.read'),
      schema: {
        tags: ['users'],
        summary: 'List roles',
        response: { 200: dataSchema(z.array(roleSchema)) },
      },
    },
    async () => ({ data: await listRoles(app.db) }),
  );

  app.get(
    '/admin/roles/:id',
    {
      preHandler: requirePermission('users.read'),
      schema: { tags: ['users'], params: idParams, response: { 200: dataSchema(roleSchema) } },
    },
    async (req) => ({ data: await getRole(app.db, req.params.id) }),
  );

  app.post(
    '/admin/roles',
    {
      preHandler: requirePermission('roles.manage'),
      schema: {
        tags: ['users'],
        summary: 'Create role',
        body: createRoleSchema,
        response: { 201: dataSchema(roleSchema) },
      },
    },
    async (req, reply) => {
      const role = await createRole(app.db, req.body, actorOf(req));
      await activityLog(req, {
        action: 'role.create',
        entityType: 'role',
        entityId: role.id,
        diff: { after: req.body },
      });
      return reply.status(201).send({ data: role });
    },
  );

  app.patch(
    '/admin/roles/:id',
    {
      preHandler: requirePermission('roles.manage'),
      schema: {
        tags: ['users'],
        summary: 'Update role',
        params: idParams,
        body: updateRoleSchema,
        response: { 200: dataSchema(roleSchema) },
      },
    },
    async (req) => {
      const { before, after } = await updateRole(app.db, req.params.id, req.body, actorOf(req));
      await activityLog(req, {
        action: 'role.update',
        entityType: 'role',
        entityId: after.id,
        diff: entityDiff(before, after),
      });
      return { data: after };
    },
  );

  app.delete(
    '/admin/roles/:id',
    {
      preHandler: requirePermission('roles.manage'),
      schema: {
        tags: ['users'],
        summary: 'Delete a non-system role',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const role = await deleteRole(app.db, req.params.id);
      await activityLog(req, {
        action: 'role.delete',
        entityType: 'role',
        entityId: role.id,
        diff: { before: role },
      });
      return reply.status(204).send(null);
    },
  );

  // ------------------------------------------------------------ staff users
  app.get(
    '/admin/users',
    {
      preHandler: requirePermission('users.read'),
      schema: {
        tags: ['users'],
        summary: 'List staff users',
        querystring: paginationQuerySchema.extend(staffListQuerySchema.shape),
        response: { 200: paginatedSchema(staffUserSchema) },
      },
    },
    async (req) => {
      const { data, total } = await listStaff(app.db, req.query);
      return paginate(data, total, req.query);
    },
  );

  app.get(
    '/admin/users/:id',
    {
      preHandler: requirePermission('users.read'),
      schema: { tags: ['users'], params: idParams, response: { 200: dataSchema(staffUserSchema) } },
    },
    async (req) => ({ data: await getStaff(app.db, req.params.id) }),
  );

  app.post(
    '/admin/users',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Create staff user with a password',
        body: createStaffUserSchema,
        response: { 201: dataSchema(staffUserSchema) },
      },
    },
    async (req, reply) => {
      const user = await createStaff(app.db, req.body, actorOf(req));
      await activityLog(req, {
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        diff: { after: { email: user.email, role: user.role, roles: user.roles } },
      });
      return reply.status(201).send({ data: user });
    },
  );

  app.post(
    '/admin/users/invite',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Invite a staff user by email (sets password via link)',
        body: inviteStaffUserSchema,
        response: { 201: dataSchema(staffUserSchema) },
      },
    },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      const user = await createStaff(
        app.db,
        { ...req.body, password: crypto.randomUUID() + crypto.randomUUID() },
        actorOf(req),
      );
      await sendInvite(app, user, `${req.auth.user.firstName} ${req.auth.user.lastName}`.trim());
      await activityLog(req, {
        action: 'user.invite',
        entityType: 'user',
        entityId: user.id,
        diff: { after: { email: user.email, role: user.role, roles: user.roles } },
      });
      return reply.status(201).send({ data: await getStaff(app.db, user.id) });
    },
  );

  app.post(
    '/admin/users/:id/resend-invite',
    {
      preHandler: requirePermission('users.manage'),
      schema: { tags: ['users'], params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const user = await getStaff(app.db, req.params.id);
      if (!user.active) throw badRequest('This user is disabled; enable the account first');
      if (!(await hasPendingToken(app.db, user.id, 'invite')) && user.lastLoginAt) {
        throw badRequest('This user has already accepted the invitation');
      }
      await sendInvite(app, user, `${req.auth.user.firstName} ${req.auth.user.lastName}`.trim());
      await activityLog(req, {
        action: 'user.invite_resent',
        entityType: 'user',
        entityId: user.id,
      });
      return { data: { ok: true as const } };
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Update staff user (fields + role assignment)',
        params: idParams,
        body: updateStaffUserSchema,
        response: { 200: dataSchema(staffUserSchema) },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const { before, after } = await updateStaff(app.db, req.params.id, req.body, actorOf(req));
      await activityLog(req, {
        action: 'user.update',
        entityType: 'user',
        entityId: after.id,
        diff: entityDiff(before, after),
      });
      return { data: after };
    },
  );

  app.post(
    '/admin/users/:id/disable',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Disable user, revoke sessions + API keys',
        params: idParams,
        response: { 200: dataSchema(staffUserSchema) },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const user = await setStaffActive(app.db, req.params.id, false, actorOf(req));
      await activityLog(req, { action: 'user.disable', entityType: 'user', entityId: user.id });
      return { data: user };
    },
  );

  app.post(
    '/admin/users/:id/enable',
    {
      preHandler: requirePermission('users.manage'),
      schema: { tags: ['users'], params: idParams, response: { 200: dataSchema(staffUserSchema) } },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const user = await setStaffActive(app.db, req.params.id, true, actorOf(req));
      await activityLog(req, { action: 'user.enable', entityType: 'user', entityId: user.id });
      return { data: user };
    },
  );

  app.post(
    '/admin/users/:id/reset-2fa',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Remove the user TOTP secret and sessions (they must enrol again)',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await resetTwoFactor(app.db, req.params.id, actorOf(req));
      await activityLog(req, {
        action: 'user.2fa_reset',
        entityType: 'user',
        entityId: req.params.id,
      });
      return { data: { ok: true as const } };
    },
  );

  app.post(
    '/admin/users/:id/unlock',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Clear the brute-force lock for this account',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      // Staff accounts only, like the rest of this module; client lockouts clear from the client record.
      const u = await getStaff(app.db, req.params.id);
      await new LoginLockout(app.redis).unlockAccount(u.email);
      await activityLog(req, {
        action: 'user.unlock',
        entityType: 'user',
        entityId: req.params.id,
      });
      return { data: { ok: true as const } };
    },
  );

  // ------------------------------------------------------------ all API keys
  app.get(
    '/admin/api-keys',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'List every API key',
        querystring: paginationQuerySchema.extend({
          includeRevoked: z.coerce.boolean().default(false),
        }),
        response: { 200: paginatedSchema(adminApiKeySchema) },
      },
    },
    async (req) => {
      const { data, total } = await listAllApiKeys(app.db, req.query);
      return paginate(data, total, req.query);
    },
  );

  app.delete(
    '/admin/api-keys/:id',
    {
      preHandler: requirePermission('users.manage'),
      schema: {
        tags: ['users'],
        summary: 'Revoke any API key',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (!(await revokeApiKey(app.db, req.params.id))) throw notFound('API key');
      await activityLog(req, {
        action: 'api_key.revoke',
        entityType: 'api_key',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;

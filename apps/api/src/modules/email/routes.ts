import { testSmtp } from '@provisia/email';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireRole, requireStaff } from '../../lib/auth.js';
import { unauthorized } from '../../lib/errors.js';
import { queueEmails } from './queue.js';
import {
  dataSchema,
  emailLogDetailSchema,
  emailLogQuerySchema,
  emailLogSchema,
  emailTemplateSchema,
  idParamsSchema,
  notificationQuerySchema,
  notificationSchema,
  paginatedSchema,
  previewEmailTemplateSchema,
  renderedEmailSchema,
  smtpTestResultSchema,
  smtpTestSchema,
  templateListQuerySchema,
  templateParamsSchema,
  testSendEmailSchema,
  unreadCountSchema,
  upsertEmailTemplateSchema,
} from './schemas.js';
import {
  getEmailLog,
  getTemplate,
  listEmailLog,
  listNotifications,
  listTemplates,
  markAllRead,
  markRead,
  previewTemplate,
  resendJob,
  resetTemplate,
  testSendJob,
  unreadCount,
  upsertTemplate,
} from './service.js';

const requireAdmin = requireRole('admin');
const T = ['email'];

const routes: FastifyPluginAsyncZod = async (app) => {
  const userId = (req: { auth: { user: { id: string } } | null }) => {
    if (!req.auth) throw unauthorized();
    return req.auth.user.id;
  };

  /* ---------------------------------------- templates ---------------------------------------- */

  app.get(
    '/admin/email/templates',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        summary: 'All template keys for a locale (built-in merged with overrides)',
        querystring: templateListQuerySchema,
        response: { 200: dataSchema(z.array(emailTemplateSchema)) },
      },
    },
    async (req) => ({
      data: await listTemplates(app.db, req.query.locale),
    }),
  );

  app.get(
    '/admin/email/templates/:key/:locale',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        params: templateParamsSchema,
        response: { 200: dataSchema(emailTemplateSchema) },
      },
    },
    async (req) => ({
      data: await getTemplate(app.db, req.params.key, req.params.locale),
    }),
  );

  app.put(
    '/admin/email/templates/:key/:locale',
    {
      preHandler: requireAdmin,
      schema: {
        tags: T,
        summary: 'Create or replace the override for a template',
        params: templateParamsSchema,
        body: upsertEmailTemplateSchema,
        response: { 200: dataSchema(emailTemplateSchema) },
      },
    },
    async (req) => {
      const t = await upsertTemplate(app.db, req.params.key, req.params.locale, req.body);
      await activityLog(req, {
        action: 'email_template.update',
        entityType: 'email_template',
        entityId: t.id,
        diff: { key: t.key, locale: t.locale, enabled: t.enabled },
      });
      return { data: t };
    },
  );

  app.delete(
    '/admin/email/templates/:key/:locale',
    {
      preHandler: requireAdmin,
      schema: {
        tags: T,
        summary: 'Reset to the built-in template',
        params: templateParamsSchema,
        response: { 200: dataSchema(emailTemplateSchema) },
      },
    },
    async (req) => {
      const t = await resetTemplate(app.db, req.params.key, req.params.locale);
      await activityLog(req, {
        action: 'email_template.reset',
        entityType: 'email_template',
        diff: { key: t.key, locale: t.locale },
      });
      return { data: t };
    },
  );

  app.post(
    '/admin/email/templates/:key/:locale/preview',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        summary: 'Render with sample data (optionally unsaved subject/body)',
        params: templateParamsSchema,
        body: previewEmailTemplateSchema,
        response: { 200: dataSchema(renderedEmailSchema) },
      },
    },
    async (req) => ({
      data: await previewTemplate(app.db, req.params.key, req.params.locale, req.body),
    }),
  );

  app.post(
    '/admin/email/templates/:key/test-send',
    {
      preHandler: requireAdmin,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: T,
        summary: 'Queue a test email with sample data',
        params: z.object({ key: z.string() }),
        body: testSendEmailSchema,
        response: { 202: dataSchema(z.object({ queued: z.boolean() })) },
      },
    },
    async (req, reply) => {
      await queueEmails([testSendJob(req.params.key, req.body.to, req.body.locale)]);
      await activityLog(req, {
        action: 'email_template.test_send',
        entityType: 'email_template',
        diff: { key: req.params.key, to: req.body.to },
      });
      return reply.status(202).send({ data: { queued: true } });
    },
  );

  /* ---------------------------------------- smtp ---------------------------------------- */

  app.post(
    '/admin/email/smtp/test',
    {
      preHandler: requireAdmin,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: T,
        summary: 'Verify SMTP connection (settings group `mail`) and send a test message',
        body: smtpTestSchema,
        response: { 200: dataSchema(smtpTestResultSchema) },
      },
    },
    async (req) => {
      const result = await testSmtp(app.db, { to: req.body.to });
      await activityLog(req, {
        action: 'email.smtp_test',
        entityType: 'settings',
        diff: { ok: result.ok, to: req.body.to },
      });
      return { data: result };
    },
  );

  /* ---------------------------------------- log ---------------------------------------- */

  app.get(
    '/admin/email/log',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        querystring: emailLogQuerySchema,
        response: { 200: paginatedSchema(emailLogSchema) },
      },
    },
    async (req) => listEmailLog(app.db, req.query),
  );

  app.get(
    '/admin/email/log/:id',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        params: idParamsSchema,
        response: { 200: dataSchema(emailLogDetailSchema) },
      },
    },
    async (req) => ({
      data: await getEmailLog(app.db, req.params.id),
    }),
  );

  app.post(
    '/admin/email/log/:id/resend',
    {
      preHandler: requireStaff,
      schema: {
        tags: T,
        summary: 'Queue the same email again (optionally to another address)',
        params: idParamsSchema,
        body: z.object({ to: z.email().optional() }).default({}),
        response: { 202: dataSchema(z.object({ queued: z.boolean() })) },
      },
    },
    async (req, reply) => {
      const { job, original } = await resendJob(app.db, req.params.id, req.body?.to);
      await queueEmails([job]);
      await activityLog(req, {
        action: 'email.resend',
        entityType: 'email_log',
        entityId: original.id,
        diff: { to: job.to },
      });
      return reply.status(202).send({ data: { queued: true } });
    },
  );

  /* ---------------------------------------- notifications ---------------------------------------- */

  app.get(
    '/admin/notifications',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['notifications'],
        querystring: notificationQuerySchema,
        response: { 200: paginatedSchema(notificationSchema) },
      },
    },
    async (req) => listNotifications(app.db, userId(req), req.query),
  );
  app.get(
    '/admin/notifications/unread-count',
    {
      preHandler: requireStaff,
      schema: { tags: ['notifications'], response: { 200: dataSchema(unreadCountSchema) } },
    },
    async (req) => ({
      data: { unread: await unreadCount(app.db, userId(req)) },
    }),
  );
  app.post(
    '/admin/notifications/:id/read',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['notifications'],
        params: idParamsSchema,
        response: { 200: dataSchema(notificationSchema) },
      },
    },
    async (req) => ({
      data: await markRead(app.db, userId(req), req.params.id),
    }),
  );
  app.post(
    '/admin/notifications/read-all',
    {
      preHandler: requireStaff,
      schema: {
        tags: ['notifications'],
        response: { 200: dataSchema(z.object({ updated: z.number().int() })) },
      },
    },
    async (req) => ({
      data: { updated: await markAllRead(app.db, userId(req)) },
    }),
  );
};

export default routes;

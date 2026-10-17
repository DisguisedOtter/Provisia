import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireAuth } from '../../lib/auth.js';
import { unauthorized } from '../../lib/errors.js';
import { clearSessionCookie, SESSION_COOKIE, sessionCookieOptions } from '../../plugins/auth.js';
import { loginRequestSchema, loginResponseSchema, meResponseSchema } from './schemas.js';
import { authenticate, createSession, destroySession } from './service.js';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Log in with email and password; sets the session cookie',
        security: [],
        body: loginRequestSchema,
        response: { 200: loginResponseSchema },
      },
    },
    async (req, reply) => {
      const user = await authenticate(app.db, req.body.email, req.body.password);
      const session = await createSession(app.db, {
        userId: user.id,
        ttlDays: app.config.SESSION_TTL_DAYS,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      req.auth = { user, via: 'session', sessionId: session.id };
      reply.setCookie(SESSION_COOKIE, session.id, sessionCookieOptions(app));
      await activityLog(req, { action: 'auth.login', entityType: 'user', entityId: user.id });
      return { data: user };
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Destroy the current session',
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (req.auth?.sessionId) {
        await destroySession(app.db, req.auth.sessionId);
        await activityLog(req, {
          action: 'auth.logout',
          entityType: 'user',
          entityId: req.auth.user.id,
        });
      }
      clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Current user',
        response: { 200: meResponseSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      return { data: req.auth.user };
    },
  );
};

export default routes;

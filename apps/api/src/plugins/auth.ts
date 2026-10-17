import cookie from '@fastify/cookie';
import { apiKeys, clients, sessions, users } from '@provisia/db';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { findApiKey } from '../lib/api-key.js';
import { AppError } from '../lib/errors.js';
import type { AuthContext } from '../types.js';

export const SESSION_COOKIE = 'pv_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function loadAuthUser(req: FastifyRequest, userId: string) {
  const [row] = await req.server.db
    .select({ user: users, clientId: clients.id })
    .from(users)
    .leftJoin(clients, eq(clients.userId, users.id))
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .limit(1);
  if (!row) return null;
  const { passwordHash: _omit, ...user } = row.user;
  return { ...user, clientId: row.clientId ?? null };
}

async function resolveSession(req: FastifyRequest): Promise<AuthContext | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const [session] = await req.server.db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, unsigned.value), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const user = await loadAuthUser(req, session.userId);
  return user ? { user, via: 'session', sessionId: session.id } : null;
}

async function resolveApiKey(req: FastifyRequest, token: string): Promise<AuthContext | null> {
  const key = await findApiKey(req.server.db, token);
  if (!key) return null;
  const user = await loadAuthUser(req, key.userId);
  if (!user) return null;
  // Best effort, not awaited: a failed timestamp update must not fail the request.
  req.server.db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch((err) => req.log.warn({ err }, 'failed to update api key last_used_at'));
  return { user, via: 'api_key', apiKeyId: key.id };
}

/**
 * CSRF for cookie sessions: SameSite=Lax cookies plus an Origin check on mutations.
 * API-key requests are not browser-originated and are exempt.
 */
function assertSameOrigin(req: FastifyRequest, allowed: Set<string>) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin)) {
    throw new AppError('csrf_origin_mismatch', 'Request origin is not allowed', 403);
  }
  if (!origin && req.headers['sec-fetch-site'] === 'cross-site') {
    throw new AppError('csrf_origin_mismatch', 'Cross-site request rejected', 403);
  }
}

export default fp(
  async (app) => {
    await app.register(cookie, { secret: app.config.SESSION_SECRET });
    app.decorateRequest('auth', null);

    const allowedOrigins = new Set(
      [app.config.WEB_URL, app.config.APP_URL].map((u) => new URL(u).origin),
    );

    app.addHook('onRequest', async (req) => {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        req.auth = await resolveApiKey(req, header.slice(7).trim());
        if (!req.auth) throw new AppError('unauthorized', 'Invalid API key', 401);
        return;
      }
      req.auth = await resolveSession(req);
      if (req.auth) assertSameOrigin(req, allowedOrigins);
    });
  },
  { name: 'auth', dependencies: ['db'] },
);

export function sessionCookieOptions(app: {
  config: { NODE_ENV: string; SESSION_TTL_DAYS: number };
}) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.config.NODE_ENV === 'production',
    signed: true,
    maxAge: app.config.SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

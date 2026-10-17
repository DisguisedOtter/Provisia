import cookie from '@fastify/cookie';
import { sessions } from '@provisia/db';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { findApiKey, touchApiKey } from '../lib/api-key.js';
import { loadAuthUser } from '../lib/auth-user.js';
import { AppError } from '../lib/errors.js';
import { registerAdminAuditHook } from '../modules/activity/hook.js';
import type { AuthContext } from '../types.js';

export const SESSION_COOKIE = 'pv_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** `last_seen_at` is written at most once per session per this interval. */
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
const lastSeenWrites = new Map<string, number>();

async function resolveSession(req: FastifyRequest): Promise<AuthContext | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const [session] = await req.server.db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      impersonatorUserId: sessions.impersonatorUserId,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, unsigned.value), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const user = await loadAuthUser(req.server.db, session.userId, {
    impersonatorUserId: session.impersonatorUserId,
  });
  if (!user) return null;
  touchSession(req, session.id);
  const ctx: AuthContext = { user, via: 'session', sessionId: session.id };
  if (session.impersonatorUserId) ctx.impersonatorUserId = session.impersonatorUserId;
  return ctx;
}

function touchSession(req: FastifyRequest, sessionId: string) {
  const now = Date.now();
  if (now - (lastSeenWrites.get(sessionId) ?? 0) < LAST_SEEN_INTERVAL_MS) return;
  lastSeenWrites.set(sessionId, now);
  if (lastSeenWrites.size > 10_000) lastSeenWrites.clear();
  req.server.db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .catch((err) => req.log.warn({ err }, 'failed to update session last_seen_at'));
}

async function resolveApiKey(req: FastifyRequest, token: string): Promise<AuthContext | null> {
  const key = await findApiKey(req.server.db, token);
  if (!key) return null;
  const user = await loadAuthUser(req.server.db, key.userId);
  if (!user) return null;
  touchApiKey(req.server.db, key.id, req.ip, (err) =>
    req.log.warn({ err }, 'failed to update api key last_used'),
  );
  return { user, via: 'api_key', apiKeyId: key.id, apiKeyScopes: key.scopes };
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
    app.decorateRequest('activityLogged', false);

    const allowedOrigins = new Set(
      [app.config.WEB_URL, app.config.APP_URL].map((u) => new URL(u).origin),
    );

    // Resolution runs in onRequest so the rate limiter can key on the user; failures are only thrown in
    // preValidation, after the (route-level) rate limiter has counted the request, so invalid API keys
    // and CSRF failures cannot be hammered without limit.
    app.decorateRequest('authError', null);
    app.addHook('onRequest', async (req) => {
      const header = req.headers.authorization;
      try {
        if (header?.startsWith('Bearer ')) {
          req.auth = await resolveApiKey(req, header.slice(7).trim());
          if (!req.auth) throw new AppError('unauthorized', 'Invalid API key', 401);
          return;
        }
        req.auth = await resolveSession(req);
        if (req.auth) assertSameOrigin(req, allowedOrigins);
      } catch (err) {
        req.auth = null;
        req.authError =
          err instanceof AppError ? err : new AppError('unauthorized', 'Unauthorized', 401);
      }
    });
    app.addHook('preValidation', async (req) => {
      if (req.authError) throw req.authError;
    });

    registerAdminAuditHook(app);
  },
  { name: 'auth', dependencies: ['db'] },
);

interface CookieApp {
  config: { NODE_ENV: string; SESSION_TTL_DAYS: number; APP_URL: string };
}

/** Session TTL in ms for a new session: 30 days (remember me) or `security.sessionTtlHours`. */
export function sessionTtlMs(app: CookieApp, rememberMe: boolean, sessionTtlHours = 24): number {
  return rememberMe
    ? app.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
    : sessionTtlHours * 60 * 60 * 1000;
}

/**
 * Cookie flags: httpOnly, SameSite=Lax, signed, Secure in production or whenever the app is served over
 * https. With `rememberMe` the cookie persists for `SESSION_TTL_DAYS`; otherwise it is a browser-session
 * cookie (no Max-Age) and the server-side row expires after `security.sessionTtlHours`.
 */
export function sessionCookieOptions(app: CookieApp, rememberMe = true) {
  const base = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.config.NODE_ENV === 'production' || app.config.APP_URL.startsWith('https://'),
    signed: true,
  };
  return rememberMe ? { ...base, maxAge: app.config.SESSION_TTL_DAYS * 24 * 60 * 60 } : base;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, rememberMe: boolean) {
  reply.setCookie(SESSION_COOKIE, sessionId, sessionCookieOptions(reply.server, rememberMe));
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

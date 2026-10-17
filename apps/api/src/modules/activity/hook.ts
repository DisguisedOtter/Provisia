import { activityLog as activityLogTable } from '@provisia/db';
import type { FastifyInstance } from 'fastify';
import { redactSecrets } from '../../lib/activity-log.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_PREFIX = '/api/v1/admin/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Safety net for ARCHITECTURE §6 "every mutation writes activity_log": after a successful (2xx/3xx)
 * non-GET request under `/api/v1/admin/*` whose handler did not call `activityLog()`, write a generic row:
 * action `admin.<method>`, entity type from the first path segment after `/admin/`, entity id from
 * `params.id` when it is a uuid, and `{ route, params, body }` (secrets redacted, body capped) as diff.
 */
export function registerAdminAuditHook(app: FastifyInstance): void {
  // `onSend` (not `onResponse`) so the row is committed before the client sees the response.
  app.addHook('onSend', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.activityLogged) return;
    if (reply.statusCode >= 400) return;
    const url = req.routeOptions.url ?? req.url;
    if (!url.startsWith(ADMIN_PREFIX)) return;
    const segments = url.slice(ADMIN_PREFIX.length).split('/').filter(Boolean);
    const entityType =
      (segments[0] ?? 'admin').replace(/[^a-z0-9_-]/gi, '').slice(0, 50) || 'admin';
    const params = (req.params ?? {}) as Record<string, unknown>;
    const idParam = typeof params.id === 'string' && UUID_RE.test(params.id) ? params.id : null;
    const body =
      req.body && typeof req.body === 'object' ? capBody(redactSecrets(req.body)) : undefined;
    try {
      await app.db.insert(activityLogTable).values({
        actorUserId: req.auth?.user.id ?? null,
        actorType: req.auth ? (req.auth.via === 'api_key' ? 'api_key' : 'user') : 'system',
        impersonatorUserId: req.auth?.user.impersonator?.id ?? null,
        action: `admin.${req.method.toLowerCase()}`,
        entityType,
        entityId: idParam,
        diff: { route: `${req.method} ${url}`, params: redactSecrets(params), body, auto: true },
        ip: req.ip,
        userAgent:
          typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent'].slice(0, 500)
            : null,
      });
    } catch (err) {
      req.log.warn({ err }, 'auto activity log failed');
    }
  });
}

function capBody(body: unknown): unknown {
  const json = JSON.stringify(body);
  if (json.length <= 4000) return body;
  return { truncated: true, preview: json.slice(0, 4000) };
}

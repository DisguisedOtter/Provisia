import { activityLog as activityLogTable, type Db } from '@provisia/db';
import type { FastifyRequest } from 'fastify';

export interface ActivityInput {
  /** Dotted verb: `client.create`, `invoice.issue`, `service.suspend`. */
  action: string;
  /** Entity name: `client`, `invoice`, `service`, ... */
  entityType: string;
  entityId?: string | null;
  /** Typically `{ before, after }`; keep it small and never include secrets (`redactSecrets()` helps). */
  diff?: Record<string, unknown> | null;
}

const SECRET_KEY_RE = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|totp|otp|code$/i;

/** Deep-copies `value` replacing secret-looking keys with `[redacted]`. Use for request bodies in diffs. */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redactSecrets(v, depth + 1);
  }
  return out as T;
}

/** `{ before, after }` limited to the keys that actually changed. */
export function entityDiff<T extends Record<string, unknown>>(
  before: Partial<T> | null | undefined,
  after: Partial<T> | null | undefined,
): { before: Partial<T>; after: Partial<T> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const bv = before?.[k];
    const av = after?.[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv;
      a[k] = av;
    }
  }
  return redactSecrets({ before: b as Partial<T>, after: a as Partial<T> });
}

/**
 * Writes an audit row for a mutation performed in a request. Every mutating route calls this.
 * Records actor (user/api key/system), impersonator, ip and user agent. Marks the request as logged so the
 * automatic admin-mutation hook (`modules/activity/hook.ts`) does not write a second, generic row.
 */
export async function activityLog(
  req: FastifyRequest,
  input: ActivityInput,
  db: Db = req.server.db,
) {
  req.activityLogged = true;
  await db.insert(activityLogTable).values({
    actorUserId: req.auth?.user.id ?? null,
    actorType: req.auth ? (req.auth.via === 'api_key' ? 'api_key' : 'user') : 'system',
    impersonatorUserId: req.auth?.user.impersonator?.id ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    diff: input.diff ?? null,
    ip: req.ip,
    userAgent: truncate(req.headers['user-agent'], 500),
  });
}

/** Same, for code paths without a request (worker, CLI). */
export async function systemActivityLog(db: Db, input: ActivityInput) {
  await db.insert(activityLogTable).values({
    actorUserId: null,
    actorType: 'system',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    diff: input.diff ?? null,
    ip: null,
    userAgent: null,
  });
}

function truncate(v: string | string[] | undefined, max: number): string | null {
  if (!v) return null;
  const s = Array.isArray(v) ? v.join(' ') : v;
  return s.length > max ? s.slice(0, max) : s;
}

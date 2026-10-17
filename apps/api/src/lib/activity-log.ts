import { activityLog as activityLogTable, type Db } from '@provisia/db';
import type { FastifyRequest } from 'fastify';

export interface ActivityInput {
  /** Dotted verb: `client.create`, `invoice.issue`, `service.suspend`. */
  action: string;
  /** Entity name: `client`, `invoice`, `service`, ... */
  entityType: string;
  entityId?: string | null;
  /** Typically `{ before, after }`; keep it small and never include secrets. */
  diff?: Record<string, unknown> | null;
}

/** Writes an audit row for a mutation performed in a request. Every mutating route calls this. */
export async function activityLog(
  req: FastifyRequest,
  input: ActivityInput,
  db: Db = req.server.db,
) {
  await db.insert(activityLogTable).values({
    actorUserId: req.auth?.user.id ?? null,
    actorType: req.auth ? (req.auth.via === 'api_key' ? 'api_key' : 'user') : 'system',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    diff: input.diff ?? null,
    ip: req.ip,
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
  });
}

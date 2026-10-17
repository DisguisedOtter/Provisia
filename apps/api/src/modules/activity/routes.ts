import { activityLog as activityLogTable, users } from '@provisia/db';
import { dataSchema, paginate, paginatedSchema, paginationQuerySchema } from '@provisia/shared';
import { and, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';

export const activityEntrySchema = z.object({
  id: z.uuid(),
  actorUserId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  actorType: z.string(),
  impersonatorUserId: z.uuid().nullable(),
  impersonatorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const activityQuerySchema = paginationQuerySchema.extend({
  actorUserId: z.uuid().optional(),
  actorType: z.enum(['user', 'api_key', 'system']).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.uuid().optional(),
  /** Exact action or prefix match with trailing `*` (`invoice.*`). */
  action: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().max(100).optional(),
});

const routes: FastifyPluginAsyncZod = async (app) => {
  const baseSelect = () =>
    app.db
      .select({
        id: activityLogTable.id,
        actorUserId: activityLogTable.actorUserId,
        actorEmail: users.email,
        actorType: activityLogTable.actorType,
        impersonatorUserId: activityLogTable.impersonatorUserId,
        action: activityLogTable.action,
        entityType: activityLogTable.entityType,
        entityId: activityLogTable.entityId,
        diff: activityLogTable.diff,
        ip: activityLogTable.ip,
        userAgent: activityLogTable.userAgent,
        createdAt: activityLogTable.createdAt,
      })
      .from(activityLogTable)
      .leftJoin(users, eq(users.id, activityLogTable.actorUserId));

  async function withImpersonators<T extends { impersonatorUserId: string | null }>(rows: T[]) {
    const ids = [
      ...new Set(rows.map((r) => r.impersonatorUserId).filter((v): v is string => Boolean(v))),
    ];
    const map = new Map<string, string>();
    for (const id of ids) {
      const [u] = await app.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (u) map.set(id, u.email);
    }
    return rows.map((r) => ({
      ...r,
      impersonatorEmail: r.impersonatorUserId ? (map.get(r.impersonatorUserId) ?? null) : null,
    }));
  }

  app.get(
    '/admin/activity',
    {
      preHandler: requirePermission('activity.read'),
      schema: {
        tags: ['activity'],
        summary: 'Audit log with filters',
        querystring: activityQuerySchema,
        response: { 200: paginatedSchema(activityEntrySchema) },
      },
    },
    async (req) => {
      const q = req.query;
      const where = and(
        q.actorUserId ? eq(activityLogTable.actorUserId, q.actorUserId) : undefined,
        q.actorType ? eq(activityLogTable.actorType, q.actorType) : undefined,
        q.entityType ? eq(activityLogTable.entityType, q.entityType) : undefined,
        q.entityId ? eq(activityLogTable.entityId, q.entityId) : undefined,
        q.action
          ? q.action.endsWith('*')
            ? ilike(activityLogTable.action, `${q.action.slice(0, -1)}%`)
            : eq(activityLogTable.action, q.action)
          : undefined,
        q.from ? gte(activityLogTable.createdAt, q.from) : undefined,
        q.to ? lte(activityLogTable.createdAt, q.to) : undefined,
        q.search
          ? or(
              ilike(activityLogTable.action, `%${q.search}%`),
              ilike(users.email, `%${q.search}%`),
              ilike(activityLogTable.ip, `%${q.search}%`),
            )
          : undefined,
      );
      const [rows, [total]] = await Promise.all([
        baseSelect()
          .where(where)
          .orderBy(desc(activityLogTable.createdAt))
          .limit(q.perPage)
          .offset((q.page - 1) * q.perPage),
        app.db
          .select({ n: count() })
          .from(activityLogTable)
          .leftJoin(users, eq(users.id, activityLogTable.actorUserId))
          .where(where),
      ]);
      return paginate(await withImpersonators(rows), Number(total?.n ?? 0), q);
    },
  );

  app.get(
    '/admin/activity/:id',
    {
      preHandler: requirePermission('activity.read'),
      schema: {
        tags: ['activity'],
        params: z.object({ id: z.uuid() }),
        response: { 200: dataSchema(activityEntrySchema) },
      },
    },
    async (req) => {
      const [row] = await baseSelect().where(eq(activityLogTable.id, req.params.id)).limit(1);
      if (!row) throw notFound('Activity entry');
      const [withImp] = await withImpersonators([row]);
      if (!withImp) throw notFound('Activity entry');
      return { data: withImp };
    },
  );
};

export default routes;

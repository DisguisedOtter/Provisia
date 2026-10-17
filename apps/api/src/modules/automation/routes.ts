import { jobsLog } from '@provisia/db';
import { dataSchema, paginate, paginatedSchema, paginationQuerySchema } from '@provisia/shared';
import { getQueue, QUEUE_NAMES, type QueueName } from '@provisia/worker/queues';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requirePermission } from '../../lib/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';

const queueNameSchema = z.enum(QUEUE_NAMES);

export const jobLogSchema = z.object({
  id: z.uuid(),
  queue: z.string(),
  jobName: z.string(),
  jobId: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed']),
  attempt: z.number().int(),
  payload: z.unknown().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  durationMs: z.number().int().nullable(),
});

export const scheduleSchema = z.object({
  /** `${queue}:${name}` — the id used by `POST /admin/automation/run/:jobName`. */
  id: z.string(),
  queue: queueNameSchema,
  name: z.string(),
  pattern: z.string().nullable(),
  every: z.number().int().nullable(),
  tz: z.string().nullable(),
  nextRunAt: z.coerce.date().nullable(),
  lastRunAt: z.coerce.date().nullable(),
  lastStatus: z.enum(['running', 'completed', 'failed']).nullable(),
});

export const queueStatsSchema = z.object({
  queue: queueNameSchema,
  waiting: z.number().int(),
  active: z.number().int(),
  delayed: z.number().int(),
  failed: z.number().int(),
  completed: z.number().int(),
  paused: z.boolean(),
  deadLetter: z.number().int(),
});

const jobsQuerySchema = paginationQuerySchema.extend({
  queue: queueNameSchema.optional(),
  jobName: z.string().max(100).optional(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function withDuration<T extends { startedAt: Date; finishedAt: Date | null }>(r: T) {
  return { ...r, durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/automation/jobs',
    {
      preHandler: requirePermission('automation.read'),
      schema: {
        tags: ['automation'],
        summary: 'Worker run history (jobs_log)',
        querystring: jobsQuerySchema,
        response: { 200: paginatedSchema(jobLogSchema) },
      },
    },
    async (req) => {
      const q = req.query;
      const where = and(
        q.queue ? eq(jobsLog.queue, q.queue) : undefined,
        q.jobName ? eq(jobsLog.jobName, q.jobName) : undefined,
        q.status ? eq(jobsLog.status, q.status) : undefined,
        q.from ? gte(jobsLog.startedAt, q.from) : undefined,
        q.to ? lte(jobsLog.startedAt, q.to) : undefined,
      );
      const [rows, [total]] = await Promise.all([
        app.db
          .select()
          .from(jobsLog)
          .where(where)
          .orderBy(desc(jobsLog.startedAt))
          .limit(q.perPage)
          .offset((q.page - 1) * q.perPage),
        app.db.select({ n: count() }).from(jobsLog).where(where),
      ]);
      return paginate(rows.map(withDuration), Number(total?.n ?? 0), q);
    },
  );

  app.get(
    '/admin/automation/jobs/:id',
    {
      preHandler: requirePermission('automation.read'),
      schema: {
        tags: ['automation'],
        params: z.object({ id: z.uuid() }),
        response: { 200: dataSchema(jobLogSchema) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select()
        .from(jobsLog)
        .where(eq(jobsLog.id, req.params.id))
        .limit(1);
      if (!row) throw notFound('Job run');
      return { data: withDuration(row) };
    },
  );

  app.post(
    '/admin/automation/jobs/:id/retry',
    {
      preHandler: requirePermission('automation.manage'),
      schema: {
        tags: ['automation'],
        summary:
          'Retry a failed run: BullMQ retry when the job still exists, otherwise re-enqueue the payload',
        params: z.object({ id: z.uuid() }),
        response: {
          202: dataSchema(
            z.object({
              queue: queueNameSchema,
              jobName: z.string(),
              jobId: z.string().nullable(),
              mode: z.enum(['retried', 'reenqueued']),
            }),
          ),
        },
      },
    },
    async (req, reply) => {
      const [row] = await app.db
        .select()
        .from(jobsLog)
        .where(eq(jobsLog.id, req.params.id))
        .limit(1);
      if (!row) throw notFound('Job run');
      if (row.status !== 'failed') throw badRequest('Only failed runs can be retried');
      const queue = getQueue(row.queue as QueueName);
      let mode: 'retried' | 'reenqueued' = 'reenqueued';
      let jobId: string | null = null;
      if (row.jobId) {
        const job = await queue.getJob(row.jobId);
        if (job && (await job.isFailed())) {
          await job.retry();
          mode = 'retried';
          jobId = job.id ?? null;
        }
      }
      if (mode === 'reenqueued') {
        const job = await queue.add(row.jobName, row.payload ?? {}, { attempts: 1 });
        jobId = job.id ?? null;
      }
      await activityLog(req, {
        action: 'automation.retry',
        entityType: 'job',
        entityId: row.id,
        diff: { queue: row.queue, jobName: row.jobName, mode },
      });
      return reply
        .status(202)
        .send({ data: { queue: row.queue as QueueName, jobName: row.jobName, jobId, mode } });
    },
  );

  app.get(
    '/admin/automation/schedules',
    {
      preHandler: requirePermission('automation.read'),
      schema: {
        tags: ['automation'],
        summary: 'Repeatable jobs with next/last run',
        response: { 200: dataSchema(z.array(scheduleSchema)) },
      },
    },
    async () => {
      const out: z.infer<typeof scheduleSchema>[] = [];
      for (const q of QUEUE_NAMES) {
        const schedulers = await getQueue(q)
          .getJobSchedulers(0, 100, true)
          .catch(() => []);
        for (const s of schedulers) {
          const name = s.name ?? s.key.split(':').slice(1).join(':');
          const [last] = await app.db
            .select({ startedAt: jobsLog.startedAt, status: jobsLog.status })
            .from(jobsLog)
            .where(and(eq(jobsLog.queue, q), eq(jobsLog.jobName, name)))
            .orderBy(desc(jobsLog.startedAt))
            .limit(1);
          out.push({
            id: s.key,
            queue: q,
            name,
            pattern: s.pattern ?? null,
            every: s.every ? Number(s.every) : null,
            tz: s.tz ?? null,
            nextRunAt: s.next ? new Date(s.next) : null,
            lastRunAt: last?.startedAt ?? null,
            lastStatus: last?.status ?? null,
          });
        }
      }
      return { data: out.sort((a, b) => a.id.localeCompare(b.id)) };
    },
  );

  app.post(
    '/admin/automation/run/:jobName',
    {
      preHandler: requirePermission('automation.manage'),
      schema: {
        tags: ['automation'],
        summary: 'Trigger a scheduled job now (`jobName` = `queue:name` as listed by /schedules)',
        params: z.object({ jobName: z.string().regex(/^[a-z]+:[A-Za-z0-9_.-]+$/) }),
        response: {
          202: dataSchema(
            z.object({ queue: queueNameSchema, name: z.string(), jobId: z.string().nullable() }),
          ),
        },
      },
    },
    async (req, reply) => {
      const [queueName, ...rest] = req.params.jobName.split(':');
      const name = rest.join(':');
      if (!QUEUE_NAMES.includes(queueName as QueueName)) throw notFound('Queue');
      const queue = getQueue(queueName as QueueName);
      const schedulers = await queue.getJobSchedulers(0, 100, true);
      const scheduler = schedulers.find((s) => s.key === req.params.jobName || s.name === name);
      if (!scheduler) throw notFound('Scheduled job');
      const job = await queue.add(name, scheduler.template?.data ?? {}, {
        jobId: `manual:${name}:${Date.now()}`,
      });
      await activityLog(req, {
        action: 'automation.run',
        entityType: 'job',
        diff: { queue: queueName, name, jobId: job.id },
      });
      return reply
        .status(202)
        .send({ data: { queue: queueName as QueueName, name, jobId: job.id ?? null } });
    },
  );

  app.get(
    '/admin/automation/queues',
    {
      preHandler: requirePermission('automation.read'),
      schema: {
        tags: ['automation'],
        summary: 'Queue depths and dead-letter counts',
        response: { 200: dataSchema(z.array(queueStatsSchema)) },
      },
    },
    async () => {
      const data: z.infer<typeof queueStatsSchema>[] = [];
      for (const q of QUEUE_NAMES) {
        const queue = getQueue(q);
        const [counts, paused, dead] = await Promise.all([
          queue
            .getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
            .catch(() => ({})),
          queue.isPaused().catch(() => false),
          app.redis.llen(`provisia:dlq:${q}`).catch(() => 0),
        ]);
        const c = counts as Record<string, number>;
        data.push({
          queue: q,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
          completed: c.completed ?? 0,
          paused,
          deadLetter: dead,
        });
      }
      return { data };
    },
  );

  app.get(
    '/admin/automation/dead-letter',
    {
      preHandler: requirePermission('automation.read'),
      schema: {
        tags: ['automation'],
        summary: 'Dead-letter entries (jobs that exhausted their retries)',
        querystring: z.object({
          queue: queueNameSchema,
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: dataSchema(z.array(z.record(z.string(), z.unknown()))) },
      },
    },
    async (req) => {
      const raw = await app.redis.lrange(`provisia:dlq:${req.query.queue}`, 0, req.query.limit - 1);
      return {
        data: raw.map((r) => {
          try {
            return JSON.parse(r) as Record<string, unknown>;
          } catch {
            return { raw: r };
          }
        }),
      };
    },
  );
};

export default routes;

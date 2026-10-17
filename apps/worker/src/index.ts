import { createServer } from 'node:http';
import { createDb, jobsLog } from '@provisia/db';
import { loadEnv } from '@provisia/shared/env';
import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { z } from 'zod';
import type { JobContext, JobHandler } from './context.js';
import { processors } from './jobs/index.js';
import { dlqKey } from './jobs/maintenance.js';
import {
  closeQueues,
  createRedisConnection,
  getQueue,
  QUEUE_NAMES,
  type QueueName,
} from './queues.js';
import { schedules } from './schedules.js';

loadEnv();
const config = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    APP_URL: z.url().default('http://localhost:3001'),
    WEB_URL: z.url().default('http://localhost:3000'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
    /** `/health` listens here; 0 disables the HTTP endpoint. */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3002),
    WORKER_HEALTH_HOST: z.string().default('0.0.0.0'),
    /** Max entries kept per dead-letter list. */
    WORKER_DLQ_MAX: z.coerce.number().int().min(10).default(1000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  })
  .parse(process.env);

const dev = config.NODE_ENV === 'development';
const logger = pino({
  level: config.LOG_LEVEL ?? (dev ? 'debug' : 'info'),
  transport: dev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

const dbClient = createDb(config.DATABASE_URL);
const redis = createRedisConnection(config.REDIS_URL);
const ctx: JobContext = {
  db: dbClient.db,
  redis,
  logger,
  appUrl: config.APP_URL,
  webUrl: config.WEB_URL,
};

const startedAt = new Date();
/** Last successful completion per queue and the last heartbeat job (also stored in Redis `worker:heartbeat`). */
const lastCompleted: Partial<Record<QueueName, string>> = {};
let lastHeartbeatAt: string | null = null;

/** Dispatches to the processor map and records every run in `jobs_log`. */
async function runJob(queue: QueueName, job: Job): Promise<unknown> {
  const handler = (processors[queue] as Record<string, JobHandler<unknown>>)[job.name];
  if (!handler) throw new Error(`no processor for ${queue}:${job.name}`);

  const [log] = await ctx.db
    .insert(jobsLog)
    .values({
      queue,
      jobName: job.name,
      jobId: job.id ?? null,
      attempt: job.attemptsMade + 1,
      payload: job.data,
    })
    .returning({ id: jobsLog.id });
  const jobLogger = logger.child({
    queue,
    job: job.name,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  });
  try {
    const result = await handler({ ...ctx, logger: jobLogger }, job.data, job);
    if (log) {
      await ctx.db
        .update(jobsLog)
        .set({ status: 'completed', result: result ?? null, finishedAt: new Date() })
        .where(eq(jobsLog.id, log.id));
    }
    lastCompleted[queue] = new Date().toISOString();
    if (queue === 'maintenance' && job.name === 'heartbeat') {
      lastHeartbeatAt = lastCompleted[queue] ?? null;
      await redis.set('worker:heartbeat', lastHeartbeatAt, 'EX', 15 * 60).catch(() => {});
    }
    return result;
  } catch (err) {
    if (log) {
      await ctx.db
        .update(jobsLog)
        .set({
          status: 'failed',
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
          finishedAt: new Date(),
        })
        .where(eq(jobsLog.id, log.id));
    }
    throw err;
  }
}

/**
 * Dead-letter policy: when a job has used its last attempt, a compact record (queue, name, id, data, error,
 * attempts, time) is pushed to the Redis list `provisia:dlq:<queue>` (capped at WORKER_DLQ_MAX, newest
 * first). The failed BullMQ job itself is kept for `removeOnFail.age` so it can still be retried from the
 * admin UI (`POST /admin/automation/jobs/:id/retry`); the daily summary reports dead-letter depth.
 */
async function deadLetter(queue: QueueName, job: Job | undefined, err: Error) {
  if (!job) return;
  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) return;
  const entry = {
    queue,
    name: job.name,
    jobId: job.id ?? null,
    data: job.data,
    error: err.message.slice(0, 2000),
    attempts: job.attemptsMade,
    failedAt: new Date().toISOString(),
  };
  try {
    await redis
      .multi()
      .lpush(dlqKey(queue), JSON.stringify(entry))
      .ltrim(dlqKey(queue), 0, config.WORKER_DLQ_MAX - 1)
      .exec();
    logger.error(
      { queue, job: job.name, jobId: job.id, attempts: job.attemptsMade },
      'job moved to dead-letter list',
    );
  } catch (dlqErr) {
    logger.error({ err: dlqErr }, 'failed to write dead-letter entry');
  }
}

const workers = QUEUE_NAMES.map((queue) => {
  const worker = new Worker(queue, (job) => runJob(queue, job), {
    connection: createRedisConnection(config.REDIS_URL),
    concurrency: config.WORKER_CONCURRENCY,
  });
  worker.on('failed', (job, err) => {
    logger.error(
      { queue, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, err },
      'job failed',
    );
    void deadLetter(queue, job, err);
  });
  worker.on('error', (err) => logger.error({ queue, err }, 'worker error'));
  return worker;
});

for (const s of schedules) {
  await getQueue(s.queue).upsertJobScheduler(
    `${s.queue}:${s.name}`,
    s.pattern ? { pattern: s.pattern } : { every: s.every ?? 60_000 },
    { name: s.name, data: s.data },
  );
}

// ------------------------------------------------------------------ /health
async function healthPayload() {
  const queues: Record<string, unknown> = {};
  let redisOk = true;
  for (const q of QUEUE_NAMES) {
    try {
      const counts = await getQueue(q).getJobCounts('waiting', 'active', 'delayed', 'failed');
      const dead = await redis.llen(dlqKey(q));
      queues[q] = { ...counts, deadLetter: dead, lastCompletedAt: lastCompleted[q] ?? null };
    } catch (err) {
      redisOk = false;
      queues[q] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const heartbeatAge = lastHeartbeatAt ? Date.now() - new Date(lastHeartbeatAt).getTime() : null;
  // Heartbeat runs every 5 minutes; three missed runs means the schedulers are stuck.
  const heartbeatOk =
    heartbeatAge === null
      ? Date.now() - startedAt.getTime() < 15 * 60 * 1000
      : heartbeatAge < 15 * 60 * 1000;
  const running = workers.every((w) => w.isRunning());
  return {
    status: redisOk && heartbeatOk && running && !stopping ? 'ok' : 'degraded',
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    stopping,
    lastHeartbeatAt,
    concurrency: config.WORKER_CONCURRENCY,
    queues,
  };
}

const healthServer =
  config.WORKER_HEALTH_PORT > 0
    ? createServer(async (req, res) => {
        if (req.url?.split('?')[0] !== '/health') {
          res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
          return;
        }
        const body = await healthPayload();
        res
          .writeHead(body.status === 'ok' ? 200 : 503, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          })
          .end(JSON.stringify(body));
      })
    : null;
healthServer?.listen(config.WORKER_HEALTH_PORT, config.WORKER_HEALTH_HOST);

logger.info(
  {
    queues: QUEUE_NAMES,
    schedules: schedules.map((s) => `${s.queue}:${s.name}`),
    healthPort: config.WORKER_HEALTH_PORT || 'disabled',
  },
  'worker started',
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down, waiting for active jobs');
  healthServer?.close();
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await redis.quit().catch(() => redis.disconnect());
  await dbClient.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

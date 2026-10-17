import { createDb, jobsLog } from '@provisia/db';
import { loadEnv } from '@provisia/shared/env';
import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { z } from 'zod';
import type { JobContext, JobHandler } from './context.js';
import { processors } from './jobs/index.js';
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
  const jobLogger = logger.child({ queue, job: job.name, jobId: job.id });
  try {
    const result = await handler({ ...ctx, logger: jobLogger }, job.data, job);
    if (log) {
      await ctx.db
        .update(jobsLog)
        .set({ status: 'completed', result: result ?? null, finishedAt: new Date() })
        .where(eq(jobsLog.id, log.id));
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

const workers = QUEUE_NAMES.map((queue) => {
  const worker = new Worker(queue, (job) => runJob(queue, job), {
    connection: createRedisConnection(config.REDIS_URL),
    concurrency: config.WORKER_CONCURRENCY,
  });
  worker.on('failed', (job, err) =>
    logger.error({ queue, job: job?.name, jobId: job?.id, err }, 'job failed'),
  );
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
logger.info(
  { queues: QUEUE_NAMES, schedules: schedules.map((s) => `${s.queue}:${s.name}`) },
  'worker started',
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down, waiting for active jobs');
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await redis.quit().catch(() => redis.disconnect());
  await dbClient.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

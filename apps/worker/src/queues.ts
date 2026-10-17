import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAMES = ['billing', 'provisioning', 'domains', 'email', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Job name -> payload, per queue. Feature agents add their jobs here (one line each) and implement the
 * processor in `apps/worker/src/jobs/<queue>/<job>.ts`. Keep payloads small: ids, not records.
 */
export interface JobPayloads {
  billing: Record<string, never>;
  provisioning: Record<string, never>;
  domains: Record<string, never>;
  email: Record<string, never>;
  maintenance: {
    heartbeat: Record<string, never>;
  };
}

export type JobName<Q extends QueueName> = keyof JobPayloads[Q] & string;
export type JobData<Q extends QueueName, N extends JobName<Q>> = JobPayloads[Q][N];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/** BullMQ requires `maxRetriesPerRequest: null`. One connection per process for producers. */
export function createRedisConnection(
  url: string = process.env.REDIS_URL ?? 'redis://localhost:6379',
) {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

/** Lazily creates the queue (and its Redis connection) on first use. */
export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    connection ??= createRedisConnection();
    q = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, q);
  }
  return q;
}

/**
 * Typed producer, importable from the API: `await enqueue('provisioning', 'create', { serviceId })`.
 * Pass `jobId` in opts for idempotent enqueues (e.g. `invoice:${id}:issue`).
 */
export async function enqueue<Q extends QueueName, N extends JobName<Q>>(
  queue: Q,
  name: N,
  data: JobData<Q, N>,
  opts?: JobsOptions,
) {
  return getQueue(queue).add(name, data, opts);
}

/** Closes producer queues and their connection. Called by both the API and the worker on shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => connection?.disconnect());
    connection = undefined;
  }
}

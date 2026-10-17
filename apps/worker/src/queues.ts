import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAMES = ['billing', 'provisioning', 'domains', 'email', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Job name -> payload, per queue. Feature agents add their jobs here (one line each) and implement the
 * processor in `apps/worker/src/jobs/<queue>/<job>.ts`. Keep payloads small: ids, not records.
 */
export interface JobPayloads {
  billing: {
    generateInvoices: { clientId?: string; daysAhead?: number };
    dunning: Record<string, never>;
    lateFees: Record<string, never>;
    viesRevalidate: { olderThanDays?: number };
    renderInvoicePdf: { invoiceId: string };
    sendInvoice: {
      invoiceId: string;
      templateKey?: 'invoice.created' | 'invoice.paid';
      to?: string;
    };
    autoPay: { invoiceId?: string; dryRun?: boolean };
    reconcilePendingPayments: { olderThanMinutes?: number };
  };
  provisioning: {
    create: { serviceId: string; serverId?: string; actorUserId?: string };
    suspend: { serviceId: string; reason?: string; actorUserId?: string };
    unsuspend: { serviceId: string; actorUserId?: string };
    terminate: { serviceId: string; actorUserId?: string };
    changePackage: { serviceId: string; productId: string; actorUserId?: string };
    changePassword: { serviceId: string; passwordEncrypted?: string; actorUserId?: string };
    syncUsage: { serviceId?: string };
    power: {
      serviceId: string;
      action: 'start' | 'stop' | 'shutdown' | 'reboot';
      actorUserId?: string;
    };
    loginUrl: { serviceId: string; actorUserId?: string };
    'activate-order': { orderId: string };
    testConnection: { serverId: string; actorUserId?: string };
    discover: { serverId: string; kind: string; config?: Record<string, unknown> };
  };
  domains: {
    register: { domainId: string };
    transfer: { domainId: string };
    renew: { domainId: string; years: number };
    sync: { domainId?: string; push?: Array<'nameservers' | 'contacts' | 'lock' | 'idProtection'> };
    expiryNotices: Record<string, never>;
    autoRenew: Record<string, never>;
    fetchEppCode: { domainId: string };
    importPricing: {
      registrarModule: string;
      markupPercent: number;
      createMissing: boolean;
      overwriteSellPrices: boolean;
    };
  };
  email: { send: import('@provisia/shared').EmailSendJob; 'imap-poll': { departmentId?: string } };
  maintenance: {
    heartbeat: Record<string, never>;
    cleanupSessions: Record<string, never>;
    cleanupTokens: Record<string, never>;
    pruneJobsLog: Record<string, never>;
    pruneActivityLog: Record<string, never>;
    cleanupTempStorage: Record<string, never>;
    dailySummary: Record<string, never>;
    ticketsAutoClose: Record<string, never>;
    ticketsEscalate: Record<string, never>;
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

/**
 * Retry/backoff policy per queue (see apps/worker/README.md). A producer may still override per job.
 *  billing      3 attempts, exponential from 5s     (idempotent invoice/dunning steps)
 *  provisioning 5 attempts, exponential from 30s    (panel APIs are flaky; create() must be idempotent)
 *  domains      5 attempts, exponential from 60s    (registrar rate limits)
 *  email        5 attempts, exponential from 10s    (SMTP greylisting)
 *  maintenance  1 attempt                            (scheduled; the next run retries anyway)
 */
export const QUEUE_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  billing: { ...DEFAULT_JOB_OPTIONS, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  provisioning: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
  },
  domains: { ...DEFAULT_JOB_OPTIONS, attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
  email: { ...DEFAULT_JOB_OPTIONS, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
  maintenance: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
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
    q = new Queue(name, { connection, defaultJobOptions: QUEUE_JOB_OPTIONS[name] });
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

import type { JobData, JobName, QueueName } from './queues.js';

export interface Schedule<Q extends QueueName = QueueName, N extends JobName<Q> = JobName<Q>> {
  queue: Q;
  name: N;
  data: JobData<Q, N>;
  /** Either an interval in ms or a cron pattern (BullMQ syntax). */
  every?: number;
  pattern?: string;
}

/** Distributes `Schedule` over every (queue, job) pair so each entry is checked against its own payload. */
type AnySchedule = {
  [Q in QueueName]: { [N in JobName<Q>]: Schedule<Q, N> }[JobName<Q>];
}[QueueName];

/** Repeatable jobs; the scheduler id is `${queue}:${name}`. One line per schedule. */
export const schedules: AnySchedule[] = [
  { queue: 'maintenance', name: 'heartbeat', data: {}, every: 5 * 60 * 1000 },
  { queue: 'maintenance', name: 'cleanupSessions', data: {}, pattern: '*/30 * * * *' },
  { queue: 'maintenance', name: 'cleanupTokens', data: {}, pattern: '10 * * * *' },
  { queue: 'maintenance', name: 'pruneJobsLog', data: {}, pattern: '20 2 * * *' },
  { queue: 'maintenance', name: 'pruneActivityLog', data: {}, pattern: '40 2 * * *' },
  { queue: 'maintenance', name: 'cleanupTempStorage', data: {}, pattern: '0 * * * *' },
  { queue: 'maintenance', name: 'dailySummary', data: {}, pattern: '0 6 * * *' },
  { queue: 'provisioning', name: 'syncUsage', data: {}, pattern: '45 2 * * *' },
  { queue: 'email', name: 'imap-poll', data: {}, every: 2 * 60 * 1000 },
  { queue: 'maintenance', name: 'ticketsAutoClose', data: {}, pattern: '0 * * * *' },
  { queue: 'maintenance', name: 'ticketsEscalate', data: {}, every: 15 * 60 * 1000 },
  { queue: 'domains', name: 'sync', data: {}, pattern: '15 4 * * *' },
  { queue: 'domains', name: 'expiryNotices', data: {}, pattern: '0 8 * * *' },
  { queue: 'domains', name: 'autoRenew', data: {}, pattern: '30 4 * * *' },
  { queue: 'billing', name: 'generateInvoices', data: {}, pattern: '0 3 * * *' },
  { queue: 'billing', name: 'dunning', data: {}, pattern: '0 9 * * *' },
  { queue: 'billing', name: 'lateFees', data: {}, pattern: '15 9 * * *' },
  { queue: 'billing', name: 'viesRevalidate', data: {}, pattern: '0 5 1 * *' },
  { queue: 'billing', name: 'autoPay', data: {}, pattern: '30 6 * * *' },
  { queue: 'billing', name: 'reconcilePendingPayments', data: {}, every: 15 * 60 * 1000 },
];

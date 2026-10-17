import type { JobData, JobName, QueueName } from './queues.js';

export interface Schedule<Q extends QueueName = QueueName, N extends JobName<Q> = JobName<Q>> {
  queue: Q;
  name: N;
  data: JobData<Q, N>;
  /** Either an interval in ms or a cron pattern (BullMQ syntax). */
  every?: number;
  pattern?: string;
}

/** Repeatable jobs; the scheduler id is `${queue}:${name}`. One line per schedule. */
export const schedules: Schedule[] = [
  { queue: 'maintenance', name: 'heartbeat', data: {}, every: 5 * 60 * 1000 },
];

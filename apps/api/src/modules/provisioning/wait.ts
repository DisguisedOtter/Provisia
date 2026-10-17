import {
  createRedisConnection,
  enqueue,
  type JobData,
  type JobName,
} from '@provisia/worker/queues';
import { QueueEvents } from 'bullmq';
import { AppError } from '../../lib/errors.js';

let events: QueueEvents | undefined;

function queueEvents(): QueueEvents {
  events ??= new QueueEvents('provisioning', { connection: createRedisConnection() });
  return events;
}

/** Closes the shared QueueEvents connection (tests / shutdown). */
export async function closeProvisioningEvents(): Promise<void> {
  await events?.close();
  events = undefined;
}

/**
 * Enqueues a provisioning job and waits for the worker's result. Used for the few interactive calls
 * (test connection, discovery, SSO link) where the admin/client needs the answer in the same request;
 * the module code itself still runs in the worker, as ARCHITECTURE.md requires.
 */
export async function runProvisioningJobAndWait<N extends JobName<'provisioning'>, T = unknown>(
  name: N,
  data: JobData<'provisioning', N>,
  opts: { timeoutMs?: number; jobId?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let job: Awaited<ReturnType<typeof enqueue>>;
  try {
    job = await enqueue('provisioning', name, data, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
    });
  } catch (err) {
    throw new AppError(
      'queue_unavailable',
      `Cannot reach the job queue: ${(err as Error).message}`,
      503,
    );
  }
  try {
    return (await job.waitUntilFinished(queueEvents(), timeoutMs)) as T;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (/timed out|timeout/i.test(message)) {
      throw new AppError(
        'worker_timeout',
        'The worker did not answer in time; is it running?',
        504,
      );
    }
    throw new AppError('provisioning_failed', message.replace(/^Error:\s*/, ''), 502);
  }
}

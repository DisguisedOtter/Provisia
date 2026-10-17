import type { EmailSendJob } from '@provisia/shared';
import { getQueue } from '@provisia/worker/queues';

/**
 * Enqueues `email:send` jobs (templated or raw). Failures to reach Redis are logged by the caller and
 * must never fail the HTTP request that triggered the mail. For typed template sends from other modules
 * prefer `sendTemplateEmail()` in `lib/mail.ts`.
 */
export async function queueEmails(
  jobs: EmailSendJob[],
  opts: { jobIdPrefix?: string } = {},
): Promise<number> {
  const q = getQueue('email');
  let n = 0;
  for (const job of jobs) {
    await q.add(
      'send',
      job,
      opts.jobIdPrefix ? { jobId: `${opts.jobIdPrefix}:${n}:${job.to}` } : undefined,
    );
    n++;
  }
  return n;
}

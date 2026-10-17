import type { EmailTemplateData, EmailTemplateKey, TemplateSendJob } from '@provisia/shared';
import { getQueue } from '@provisia/worker/queues';

/**
 * Enqueues a templated email on the `email` queue (job name `send`, payload `TemplateSendJob` from
 * `@provisia/shared/email`). The support agent's worker processor renders and sends it. Never awaits SMTP.
 *
 *   await sendTemplateEmail('auth.password_reset', { to, toUserId, data: { user, actionUrl, expiresIn } });
 */
export async function sendTemplateEmail<K extends EmailTemplateKey>(
  key: K,
  message: Omit<TemplateSendJob<K>, 'key' | 'data'> & { data: EmailTemplateData[K] },
  opts: { jobId?: string } = {},
): Promise<void> {
  const payload: TemplateSendJob<K> = { key, ...message };
  await getQueue('email').add('send', payload, opts.jobId ? { jobId: opts.jobId } : undefined);
}

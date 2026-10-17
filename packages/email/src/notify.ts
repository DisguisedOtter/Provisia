import { type Db, notifications } from '@provisia/db';
import { type NotifyInput, notifyInputSchema } from '@provisia/shared';
import { loadSettings } from './settings.js';

export type NotifyEmailSink = (job: {
  key: 'admin.notification';
  to: string;
  data: Record<string, unknown>;
  related?: { type: string; id: string };
}) => Promise<unknown>;

/**
 * In-app notification for staff. `userId` null = broadcast (every admin/staff sees it until they mark
 * it read). Other agents call this from jobs/webhooks when something needs human attention:
 *
 *   await notify(db, { level: 'error', type: 'provisioning.failed', title: 'cPanel create failed',
 *                      body: err.message, link: `/admin/services/${id}`, entityType: 'service', entityId: id });
 *
 * Pass `email: true` plus an `emailSink` (e.g. `(j) => enqueue('email', 'send', j)`) to also mail
 * `company.email` using the `admin.notification` template. Never throws: a failed notification must
 * not break the caller's job.
 */
export async function notify(
  db: Db,
  input: NotifyInput,
  opts: { emailSink?: NotifyEmailSink; webUrl?: string } = {},
): Promise<{ id: string } | null> {
  try {
    const n = notifyInputSchema.parse(input);
    const [row] = await db
      .insert(notifications)
      .values({
        userId: n.userId ?? null,
        level: n.level,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
      })
      .returning({ id: notifications.id });
    if (n.email && opts.emailSink) {
      const settings = await loadSettings(db);
      const to = settings['company.email'];
      if (to) {
        const web = (opts.webUrl ?? process.env.WEB_URL ?? '').replace(/\/$/, '');
        await opts.emailSink({
          key: 'admin.notification',
          to,
          data: {
            title: n.title,
            message: n.body ?? '',
            level: n.level,
            link: n.link ? (n.link.startsWith('http') ? n.link : `${web}${n.link}`) : undefined,
          },
          ...(n.entityType && n.entityId
            ? { related: { type: n.entityType, id: n.entityId } }
            : {}),
        });
      }
    }
    return row ?? null;
  } catch {
    return null;
  }
}

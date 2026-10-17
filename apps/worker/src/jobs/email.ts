import { type DepartmentMailboxConfig, emailLog, ticketDepartments } from '@provisia/db';
import {
  loadSettings,
  notify,
  PermanentIngestError,
  parseInboundEmail,
  pollMailbox,
  processInbound,
  resolveMailConfig,
  resolveStoragePath,
  sendEmail,
} from '@provisia/email';
import { decryptJson } from '@provisia/module-sdk';
import { type EmailSendJob, emailSendJobSchema } from '@provisia/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { JobHandler } from '../context.js';
import { enqueue, type JobData } from '../queues.js';

/** Addresses with this many bounces in the last 30 days are suppressed until the log is cleaned. */
const BOUNCE_SUPPRESS_THRESHOLD = 3;

/**
 * `email:send` — renders + delivers one message. Transient SMTP errors throw so BullMQ retries with
 * backoff (3x, exponential). Permanent failures (5xx / rejected recipient) are logged as `bounced` and
 * **not** retried; an address that bounced repeatedly is skipped entirely.
 */
export const send: JobHandler<JobData<'email', 'send'>> = async (ctx, data, job) => {
  const payload = emailSendJobSchema.parse(data);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [bounces] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.toEmail, payload.to),
        eq(emailLog.status, 'bounced'),
        gte(emailLog.createdAt, since),
      ),
    );
  if ((bounces?.n ?? 0) >= BOUNCE_SUPPRESS_THRESHOLD) {
    ctx.logger.warn({ to: payload.to }, 'recipient suppressed after repeated bounces');
    const [row] = await ctx.db
      .insert(emailLog)
      .values({
        toEmail: payload.to,
        templateKey: payload.key ?? null,
        subject: payload.subject ?? payload.key ?? '',
        status: 'failed',
        error: 'suppressed: repeated bounces',
        relatedType: payload.related?.type ?? null,
        relatedId: payload.related?.id ?? null,
      })
      .returning({ id: emailLog.id });
    return { status: 'suppressed', logId: row?.id };
  }

  // Reuse the log row across retries so one email == one row.
  const logId = (job.data as { _logId?: string })._logId;
  const result = await sendEmail(ctx.db, payload, { logId, webUrl: ctx.webUrl });
  if (result.status === 'failed' && !result.permanent) {
    await job.updateData({ ...job.data, _logId: result.logId } as typeof job.data);
    throw new Error(`email delivery failed: ${result.error}`);
  }
  if (result.status === 'bounced') {
    ctx.logger.warn({ to: payload.to, error: result.error }, 'email bounced (not retried)');
  }
  return result;
};

/**
 * `email:imap-poll` — every 2 minutes: for each department with IMAP enabled, fetch unseen mail and
 * turn it into ticket replies / new tickets. Per-department failures are reported as notifications and
 * do not stop the other departments.
 */
export const imapPoll: JobHandler<JobData<'email', 'imap-poll'>> = async (ctx, data) => {
  const settings = await loadSettings(ctx.db);
  const mail = resolveMailConfig(settings);
  const where = data.departmentId
    ? and(eq(ticketDepartments.id, data.departmentId))
    : eq(ticketDepartments.imapEnabled, true);
  const depts = await ctx.db.select().from(ticketDepartments).where(where);
  const ownAddresses = new Set<string>([mail.from.address.toLowerCase()]);
  for (const d of depts) if (d.email) ownAddresses.add(d.email.toLowerCase());
  const storageRoot = resolveStoragePath(settings);
  const env = { appUrl: ctx.appUrl, webUrl: ctx.webUrl };
  const summary: Record<string, unknown> = {};

  for (const dept of depts) {
    if (!dept.mailboxConfigEncrypted) continue;
    let cfg: DepartmentMailboxConfig;
    try {
      cfg = decryptJson<DepartmentMailboxConfig>(dept.mailboxConfigEncrypted);
    } catch (err) {
      summary[dept.name] = { error: 'cannot decrypt mailbox config' };
      ctx.logger.error({ department: dept.id, err }, 'imap config undecryptable');
      continue;
    }
    if (!cfg.imap?.host) continue;
    const outcomes: Record<string, number> = {};
    try {
      const res = await pollMailbox(
        cfg.imap,
        async (msg) => {
          const parsed = await parseInboundEmail(msg.raw);
          const outcome = await processInbound(ctx.db, dept, parsed, {
            settings,
            storageRoot,
            env,
            ownAddresses,
            sendEmail: (j: EmailSendJob) => enqueue('email', 'send', j),
          });
          outcomes[outcome.action] = (outcomes[outcome.action] ?? 0) + 1;
          if (outcome.action === 'created') {
            await notify(ctx.db, {
              type: 'ticket.opened',
              title: `New ticket by email: ${parsed.subject || '(no subject)'}`,
              body: parsed.text.slice(0, 300),
              link: `/admin/tickets/${outcome.ticketId}`,
              entityType: 'ticket',
              entityId: outcome.ticketId,
            });
          }
          ctx.logger.info(
            { department: dept.name, uid: msg.uid, outcome },
            'inbound email processed',
          );
        },
        { logger: ctx.logger },
      );
      summary[dept.name] = { ...res, outcomes };
      if (res.failed > 0) {
        await notify(ctx.db, {
          level: 'warning',
          type: 'email.imap_failed',
          title: `${res.failed} inbound message(s) failed for ${dept.name}`,
          body: res.errors.slice(0, 5).join('\n'),
          link: `/admin/tickets/departments`,
          entityType: 'ticket_department',
          entityId: dept.id,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary[dept.name] = { error: message };
      ctx.logger.error({ department: dept.id, err }, 'imap poll failed');
      if (!(err instanceof PermanentIngestError)) {
        await notify(ctx.db, {
          level: 'error',
          type: 'email.imap_connection',
          title: `IMAP poll failed for ${dept.name}`,
          body: message,
          link: `/admin/tickets/departments`,
          entityType: 'ticket_department',
          entityId: dept.id,
        });
      }
    }
  }
  return { departments: depts.length, summary };
};

export const emailJobs = { send, 'imap-poll': imapPoll };

import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { activityLog, authTokens, jobsLog, sessions, settings, users } from '@provisia/db';
import {
  type AdminNotificationEmailData,
  parseSettingsGroup,
  type SettingsGroup,
  type SettingsGroupName,
  type TemplateSendJob,
} from '@provisia/shared';
import { and, count, eq, gte, like, lt, or, sql } from 'drizzle-orm';
import type { JobContext, JobHandler } from '../context.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';

type Handler = JobHandler<Record<string, never>>;

/** Worker-side settings read (no API cache): one query per group, decrypts nothing (no secrets needed here). */
async function readSettings<G extends SettingsGroupName>(
  ctx: JobContext,
  group: G,
): Promise<SettingsGroup<G>> {
  const rows = await ctx.db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(like(settings.key, `${group}.%`));
  return parseSettingsGroup(group, rows);
}

/** Deletes expired sessions. Runs every 30 minutes. */
export const cleanupSessions: Handler = async (ctx) => {
  const rows = await ctx.db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  ctx.logger.info({ deleted: rows.length }, 'expired sessions removed');
  return { deleted: rows.length };
};

/** Deletes used/expired auth tokens older than a day (verify, reset, invite, TOTP challenges). */
export const cleanupTokens: Handler = async (ctx) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await ctx.db
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, cutoff), lt(authTokens.usedAt, cutoff)))
    .returning({ id: authTokens.id });
  return { deleted: rows.length };
};

/** jobs_log retention (`automation.jobsLogRetentionDays`) plus stale `running` rows older than 24h → failed. */
export const pruneJobsLog: Handler = async (ctx) => {
  const automation = await readSettings(ctx, 'automation');
  const cutoff = new Date(Date.now() - automation.jobsLogRetentionDays * 24 * 60 * 60 * 1000);
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await ctx.db
    .update(jobsLog)
    .set({
      status: 'failed',
      error: 'marked failed by pruneJobsLog: still running after 24h',
      finishedAt: new Date(),
    })
    .where(and(eq(jobsLog.status, 'running'), lt(jobsLog.startedAt, staleCutoff)))
    .returning({ id: jobsLog.id });
  const deleted = await ctx.db
    .delete(jobsLog)
    .where(lt(jobsLog.startedAt, cutoff))
    .returning({ id: jobsLog.id });
  return {
    deleted: deleted.length,
    markedStale: stale.length,
    retentionDays: automation.jobsLogRetentionDays,
  };
};

/** activity_log retention (`automation.activityLogRetentionDays`, min 30, default 2 years). */
export const pruneActivityLog: Handler = async (ctx) => {
  const automation = await readSettings(ctx, 'automation');
  const cutoff = new Date(Date.now() - automation.activityLogRetentionDays * 24 * 60 * 60 * 1000);
  const deleted = await ctx.db
    .delete(activityLog)
    .where(lt(activityLog.createdAt, cutoff))
    .returning({ id: activityLog.id });
  return { deleted: deleted.length, retentionDays: automation.activityLogRetentionDays };
};

/** Removes files in `storage.tempPath` older than `automation.tempFileMaxAgeHours`. Never follows symlinks. */
export const cleanupTempStorage: Handler = async (ctx) => {
  const [storage, automation] = await Promise.all([
    readSettings(ctx, 'storage'),
    readSettings(ctx, 'automation'),
  ]);
  const root = path.resolve(storage.tempPath);
  const maxAgeMs = automation.tempFileMaxAgeHours * 60 * 60 * 1000;
  let removed = 0;
  let bytes = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return { removed: 0, bytes: 0, root, note: 'temp dir missing' };
  }
  for (const name of entries) {
    const full = path.join(root, name);
    if (!full.startsWith(root + path.sep)) continue;
    try {
      const st = await stat(full);
      if (Date.now() - st.mtimeMs < maxAgeMs) continue;
      bytes += st.size;
      await rm(full, { recursive: true, force: true });
      removed++;
    } catch (err) {
      ctx.logger.warn({ err, file: full }, 'temp cleanup failed for file');
    }
  }
  return { removed, bytes, root };
};

/** Dead-letter list key per queue (also read by the API's automation module). */
export const dlqKey = (queue: string) => `provisia:dlq:${queue}`;

/**
 * Daily "automation summary" to admins (`admin.notification`): job counts per queue for the last 24h,
 * failures, dead-letter depth and queue backlog. Disabled with `automation.summaryEmailEnabled`.
 */
export const dailySummary: Handler = async (ctx) => {
  const automation = await readSettings(ctx, 'automation');
  if (!automation.summaryEmailEnabled) return { skipped: 'disabled' };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await ctx.db
    .select({ queue: jobsLog.queue, status: jobsLog.status, n: count() })
    .from(jobsLog)
    .where(gte(jobsLog.startedAt, since))
    .groupBy(jobsLog.queue, jobsLog.status);
  const failures = await ctx.db
    .select({ jobName: jobsLog.jobName, queue: jobsLog.queue, n: count() })
    .from(jobsLog)
    .where(and(gte(jobsLog.startedAt, since), eq(jobsLog.status, 'failed')))
    .groupBy(jobsLog.queue, jobsLog.jobName)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  const details: AdminNotificationEmailData['details'] = {};
  let completed = 0;
  let failed = 0;
  for (const r of rows) {
    const n = Number(r.n);
    details[`${r.queue}.${r.status}`] = n;
    if (r.status === 'completed') completed += n;
    if (r.status === 'failed') failed += n;
  }
  for (const q of QUEUE_NAMES) {
    const [counts, dead] = await Promise.all([
      getQueue(q)
        .getJobCounts('waiting', 'delayed', 'failed')
        .catch(() => ({}) as Record<string, number>),
      ctx.redis.llen(dlqKey(q)).catch(() => 0),
    ]);
    const c = counts as Record<string, number>;
    details[`${q}.backlog`] = (c.waiting ?? 0) + (c.delayed ?? 0);
    details[`${q}.deadLetter`] = dead;
  }
  const topFailures = failures.map((f) => `${f.queue}:${f.jobName} (${Number(f.n)})`).join(', ');

  let recipients = automation.summaryRecipients.filter(Boolean);
  if (recipients.length === 0) {
    const admins = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true)));
    recipients = admins.map((a) => a.email);
  }
  const level: AdminNotificationEmailData['level'] = failed > 0 ? 'warning' : 'info';
  const data: AdminNotificationEmailData = {
    title: `Automation summary: ${completed} completed, ${failed} failed`,
    message:
      `In the last 24 hours the worker completed ${completed} job(s) and ${failed} failed.` +
      (topFailures ? ` Most failures: ${topFailures}.` : '') +
      ' Open Admin → Automation for details.',
    level,
    link: `${ctx.webUrl}/admin/automation`,
    details,
  };
  const day = new Date().toISOString().slice(0, 10);
  for (const to of recipients) {
    const job: TemplateSendJob<'admin.notification'> = { key: 'admin.notification', to, data };
    await getQueue('email').add('send', job, { jobId: `summary:${day}:${to}` });
  }
  return { recipients: recipients.length, completed, failed };
};

export const maintenanceJobs = {
  cleanupSessions,
  cleanupTokens,
  pruneJobsLog,
  pruneActivityLog,
  cleanupTempStorage,
  dailySummary,
};

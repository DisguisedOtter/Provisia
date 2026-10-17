import { ticketDepartments, tickets } from '@provisia/db';
import { loadSettings, setTicketStatus, ticketEmailJobs, urls } from '@provisia/email';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { JobHandler } from '../context.js';
import { enqueue, type JobData } from '../queues.js';

/**
 * `maintenance:ticketsAutoClose` — closes `answered` tickets whose last (staff) reply is older than
 * `support.autoCloseDays` (department override wins; 0 disables). Sends `ticket.closed`.
 */
export const ticketsAutoClose: JobHandler<JobData<'maintenance', 'ticketsAutoClose'>> = async (
  ctx,
) => {
  const settings = await loadSettings(ctx.db);
  const env = { appUrl: ctx.appUrl, webUrl: ctx.webUrl };
  const depts = await ctx.db
    .select({ id: ticketDepartments.id, days: ticketDepartments.autoCloseDays })
    .from(ticketDepartments);
  let closed = 0;
  for (const d of depts) {
    const days = d.days ?? settings['support.autoCloseDays'];
    if (!days || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.departmentId, d.id),
          eq(tickets.status, 'answered'),
          lt(tickets.lastReplyAt, cutoff),
        ),
      )
      .limit(200);
    for (const t of rows) {
      const updated = await setTicketStatus(ctx.db, t, 'closed');
      for (const job of await ticketEmailJobs(
        ctx.db,
        { type: 'closed', ticket: updated },
        settings,
        env,
      )) {
        await enqueue('email', 'send', job);
      }
      closed++;
    }
  }
  return { closed };
};

/**
 * `maintenance:ticketsEscalate` — emails `support.escalationEmail` once per ticket when a client
 * message (`open` / `customer_reply`) has waited longer than `support.escalationHours`.
 */
export const ticketsEscalate: JobHandler<JobData<'maintenance', 'ticketsEscalate'>> = async (
  ctx,
) => {
  const settings = await loadSettings(ctx.db);
  const to = settings['support.escalationEmail'] || settings['company.email'];
  if (!to) return { escalated: 0, reason: 'no escalation email configured' };
  const u = urls({ appUrl: ctx.appUrl, webUrl: ctx.webUrl });
  const depts = await ctx.db
    .select({
      id: ticketDepartments.id,
      name: ticketDepartments.name,
      hours: ticketDepartments.escalationHours,
    })
    .from(ticketDepartments);
  let escalated = 0;
  for (const d of depts) {
    const hours = d.hours ?? settings['support.escalationHours'];
    if (!hours || hours <= 0) continue;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.departmentId, d.id),
          or(eq(tickets.status, 'open'), eq(tickets.status, 'customer_reply')),
          isNull(tickets.escalatedAt),
          lt(sql`coalesce(${tickets.lastReplyAt}, ${tickets.createdAt})`, cutoff),
        ),
      )
      .limit(100);
    for (const t of rows) {
      const waited = Math.round(
        (Date.now() - (t.lastReplyAt ?? t.createdAt).getTime()) / 3_600_000,
      );
      await enqueue('email', 'send', {
        key: 'admin.notification',
        to,
        locale: settings['localization.defaultLocale'],
        data: {
          title: `Ticket #${t.number} unanswered for ${waited}h`,
          message: `"${t.subject}" in ${d.name} (priority ${t.priority}) has been waiting for a staff reply since ${(t.lastReplyAt ?? t.createdAt).toISOString()}.`,
          level: 'warning',
          link: u.adminTicket(t.id),
          details: {
            department: d.name,
            priority: t.priority,
            status: t.status,
            assigned: t.assignedToUserId ? 'yes' : 'no',
          },
        },
        related: { type: 'ticket', id: t.id },
      });
      await ctx.db.update(tickets).set({ escalatedAt: new Date() }).where(eq(tickets.id, t.id));
      escalated++;
    }
  }
  return { escalated };
};

export const ticketJobs = { ticketsAutoClose, ticketsEscalate };

import { type Db, type ticketDepartments, ticketReplies, tickets, users } from '@provisia/db';
import type { EmailSendJob, Settings } from '@provisia/shared';
import { desc, eq, or } from 'drizzle-orm';
import {
  addReply,
  clientByEmail,
  createTicket,
  saveAttachmentRecord,
  storeTicketFile,
  type TicketRow,
  ticketEmailJobs,
} from '../tickets/index.js';
import { PermanentIngestError } from './imap.js';
import type { ParsedInbound } from './parse.js';

export type IngestOutcome =
  | { action: 'ignored'; reason: string }
  | { action: 'duplicate'; ticketId: string }
  | { action: 'replied'; ticketId: string; replyId: string }
  | { action: 'created'; ticketId: string; replyId: string }
  | { action: 'rejected'; reason: string };

export interface IngestContext {
  settings: Settings;
  storageRoot: string;
  env?: { appUrl?: string; webUrl?: string };
  /** Receives the notification emails to enqueue (and the rejection auto-reply). */
  sendEmail: (job: EmailSendJob) => Promise<unknown>;
  /** Addresses that belong to us (department mailboxes, from address) — mail from them is ignored. */
  ownAddresses: Set<string>;
}

type DepartmentRow = typeof ticketDepartments.$inferSelect;

/** Finds the ticket a message belongs to via `[#1001]`, then In-Reply-To / References. */
export async function matchTicket(db: Db, mail: ParsedInbound): Promise<TicketRow | null> {
  if (mail.ticketNumber) {
    const [t] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.number, mail.ticketNumber))
      .limit(1);
    if (t) return t;
  }
  const ids = [mail.inReplyTo, ...mail.references].filter((x): x is string => !!x);
  for (const id of ids) {
    const m = /^<?ticket-([0-9a-f-]{36})@/i.exec(id);
    if (m?.[1]) {
      const [t] = await db.select().from(tickets).where(eq(tickets.id, m[1])).limit(1);
      if (t) return t;
    }
  }
  if (ids.length) {
    const [r] = await db
      .select({ ticketId: ticketReplies.ticketId })
      .from(ticketReplies)
      .where(or(...ids.map((id) => eq(ticketReplies.emailMessageId, id))))
      .limit(1);
    if (r) {
      const [t] = await db.select().from(tickets).where(eq(tickets.id, r.ticketId)).limit(1);
      if (t) return t;
    }
  }
  return null;
}

/** Follows merge pointers so replies to a merged ticket land on the surviving one. */
async function resolveMerged(db: Db, t: TicketRow): Promise<TicketRow> {
  let current = t;
  for (let i = 0; i < 5 && current.mergedIntoTicketId; i++) {
    const [next] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, current.mergedIntoTicketId))
      .limit(1);
    if (!next) break;
    current = next;
  }
  return current;
}

async function storeAttachments(
  db: Db,
  ticketId: string,
  replyId: string,
  mail: ParsedInbound,
  root: string,
  maxBytes: number,
) {
  for (const a of mail.attachments) {
    if (a.size > maxBytes) continue;
    const stored = await storeTicketFile(ticketId, a.filename, a.content, root);
    await saveAttachmentRecord(db, {
      ticketId,
      replyId,
      name: stored.safeName,
      path: stored.relativePath,
      size: a.size,
      mimeType: a.contentType,
    });
  }
}

/**
 * Turns one parsed inbound message into a ticket reply or a new ticket for `dept`.
 * Throws `PermanentIngestError` for messages that must be flagged and never retried.
 */
export async function processInbound(
  db: Db,
  dept: DepartmentRow,
  mail: ParsedInbound,
  ctx: IngestContext,
): Promise<IngestOutcome> {
  if (mail.isAutoReply)
    return { action: 'ignored', reason: `auto-reply (${mail.autoReplyReason})` };
  if (!mail.from?.address) throw new PermanentIngestError('message has no From address');
  const from = mail.from.address.toLowerCase();
  if (ctx.ownAddresses.has(from)) return { action: 'ignored', reason: 'own address' };

  if (mail.messageId) {
    const [dup] = await db
      .select({ ticketId: ticketReplies.ticketId })
      .from(ticketReplies)
      .where(eq(ticketReplies.emailMessageId, mail.messageId))
      .orderBy(desc(ticketReplies.createdAt))
      .limit(1);
    if (dup) return { action: 'duplicate', ticketId: dup.ticketId };
  }

  const body = mail.text.trim() || '(empty message)';
  const maxBytes = ctx.settings['storage.maxUploadMb'] * 1024 * 1024;
  const known = await clientByEmail(db, from);

  const existing = await matchTicket(db, mail);
  if (existing) {
    const target = await resolveMerged(db, existing);
    // Only the requester, the client's contacts, or staff may append by email; others open a new ticket.
    const requesterMatches =
      (target.requesterEmail && target.requesterEmail.toLowerCase() === from) ||
      (target.clientId && known?.clientId === target.clientId) ||
      target.cc.map((c) => c.toLowerCase()).includes(from);
    const staff = await staffByEmail(db, from);
    if (requesterMatches || staff) {
      const { ticket, reply } = await addReply(db, target, {
        body,
        author: staff
          ? {
              userId: staff.id,
              email: from,
              name: `${staff.firstName} ${staff.lastName}`.trim(),
              isStaff: true,
            }
          : {
              userId: known?.userId ?? null,
              email: from,
              name: mail.from.name || null,
              isStaff: false,
            },
        source: 'email',
        emailMessageId: mail.messageId,
      });
      await storeAttachments(db, ticket.id, reply.id, mail, ctx.storageRoot, maxBytes);
      for (const job of await ticketEmailJobs(
        db,
        { type: 'reply', ticket, reply, byStaff: !!staff, actorUserId: staff?.id ?? null },
        ctx.settings,
        ctx.env,
      )) {
        await ctx.sendEmail(job);
      }
      return { action: 'replied', ticketId: ticket.id, replyId: reply.id };
    }
  }

  const policy =
    dept.unknownSenderPolicy === 'inherit'
      ? ctx.settings['support.unknownSenderPolicy']
      : dept.unknownSenderPolicy;
  if (!known && policy === 'reject') {
    await ctx.sendEmail({
      to: from,
      subject: `Re: ${mail.subject || '(no subject)'}`,
      html: `<p>Thank you for your message. This mailbox only accepts support requests from registered customers. Please log in to the client area to open a ticket, or contact us via the website.</p>`,
      departmentId: dept.id,
      headers: mail.messageId
        ? { 'In-Reply-To': mail.messageId, References: mail.messageId }
        : undefined,
    });
    return { action: 'rejected', reason: 'unknown sender' };
  }

  const subject =
    (mail.subject || '(no subject)').replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim() ||
    '(no subject)';
  const { ticket, reply } = await createTicket(db, {
    departmentId: dept.id,
    subject,
    body,
    clientId: known?.clientId ?? null,
    requesterEmail: known ? null : from,
    requesterName: known ? null : mail.from.name || null,
    cc: mail.cc.filter((c) => c !== from && !ctx.ownAddresses.has(c)).slice(0, 5),
    author: {
      userId: known?.userId ?? null,
      email: from,
      name: mail.from.name || null,
      isStaff: false,
    },
    source: 'email',
    emailMessageId: mail.messageId,
  });
  await storeAttachments(db, ticket.id, reply.id, mail, ctx.storageRoot, maxBytes);
  for (const job of await ticketEmailJobs(
    db,
    { type: 'opened', ticket, reply, byStaff: false },
    ctx.settings,
    ctx.env,
  )) {
    await ctx.sendEmail(job);
  }
  return { action: 'created', ticketId: ticket.id, replyId: reply.id };
}

async function staffByEmail(db: Db, email: string) {
  const [u] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return u && u.role !== 'client' ? u : null;
}

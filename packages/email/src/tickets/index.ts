import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  clients,
  type Db,
  ticketAttachments,
  ticketDepartments,
  ticketNotes,
  ticketReplies,
  tickets,
  ticketWatchers,
  users,
} from '@provisia/db';
import {
  canTransition,
  type EmailSendJob,
  type Settings,
  statusAfterReply,
  type TicketEmailData,
  type TicketPriority,
  type TicketStatus,
  ticketSubjectToken,
} from '@provisia/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { renderString } from '../render.js';
import { resolveStoragePath, urls } from '../settings.js';

export type TicketRow = typeof tickets.$inferSelect;
export type ReplyRow = typeof ticketReplies.$inferSelect;

export class TicketTransitionError extends Error {
  constructor(
    public readonly from: TicketStatus,
    public readonly to: TicketStatus,
  ) {
    super(`Cannot change ticket status from ${from} to ${to}`);
  }
}

/** Next human ticket number from the `ticket_number_seq` sequence (1001, 1002, ...). */
export async function nextTicketNumber(db: Db): Promise<string> {
  const rows = await db.execute<{ n: string | number }>(
    sql`select nextval('ticket_number_seq') as n`,
  );
  const first = (rows as unknown as Array<{ n: string | number }>)[0];
  if (!first) throw new Error('ticket_number_seq unavailable');
  return String(first.n);
}

export interface Recipient {
  email: string;
  firstName: string;
  lastName: string;
  language: string | null;
  userId: string | null;
}

/** Primary login of a client (used for ticket mail). */
export async function clientRecipient(db: Db, clientId: string): Promise<Recipient | null> {
  const [row] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      language: clients.language,
      userId: users.id,
    })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId))
    .limit(1);
  return row ?? null;
}

/** Finds the client whose primary user (or sub-contact) has this email. */
export async function clientByEmail(
  db: Db,
  email: string,
): Promise<{ clientId: string; userId: string | null } | null> {
  const lower = email.toLowerCase();
  const [byUser] = await db
    .select({ clientId: clients.id, userId: users.id })
    .from(users)
    .innerJoin(clients, eq(clients.userId, users.id))
    .where(eq(users.email, lower))
    .limit(1);
  if (byUser) return byUser;
  const contacts = await db.execute<{ client_id: string; user_id: string | null }>(
    sql`select client_id, user_id from client_contacts where lower(email) = ${lower} limit 1`,
  );
  const c = (contacts as unknown as Array<{ client_id: string; user_id: string | null }>)[0];
  return c ? { clientId: c.client_id, userId: c.user_id } : null;
}

/** Requester of a ticket: the client's primary user, or the guest requester fields. */
export async function ticketRequester(db: Db, t: TicketRow): Promise<Recipient | null> {
  if (t.clientId) {
    const r = await clientRecipient(db, t.clientId);
    if (r) return r;
  }
  if (t.requesterEmail) {
    const [first, ...rest] = (t.requesterName ?? '').split(' ');
    return {
      email: t.requesterEmail,
      firstName: first || 'there',
      lastName: rest.join(' '),
      language: null,
      userId: null,
    };
  }
  return null;
}

/** Assignee + watchers; falls back to `support.notifyEmail` when nobody is assigned. */
export async function staffRecipients(
  db: Db,
  t: TicketRow,
  settings: Settings,
  excludeUserId?: string | null,
) {
  const ids = new Set<string>();
  if (t.assignedToUserId) ids.add(t.assignedToUserId);
  const watchers = await db
    .select({ userId: ticketWatchers.userId })
    .from(ticketWatchers)
    .where(eq(ticketWatchers.ticketId, t.id));
  for (const w of watchers) ids.add(w.userId);
  if (excludeUserId) ids.delete(excludeUserId);
  const out: Recipient[] = [];
  if (ids.size) {
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(and(inArray(users.id, [...ids]), eq(users.active, true)));
    for (const r of rows) out.push({ ...r, language: settings['localization.defaultLocale'] });
  }
  if (!t.assignedToUserId && settings['support.notifyEmail']) {
    out.push({
      email: settings['support.notifyEmail'],
      firstName: 'team',
      lastName: '',
      language: settings['localization.defaultLocale'],
      userId: null,
    });
  }
  return out;
}

async function departmentName(db: Db, id: string): Promise<string> {
  const [d] = await db
    .select({ name: ticketDepartments.name })
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .limit(1);
  return d?.name ?? 'Support';
}

function ticketData(
  t: TicketRow,
  deptName: string,
  recipient: Recipient,
  ticketUrl: string,
  extra: Partial<TicketEmailData>,
): TicketEmailData {
  return {
    recipient: { firstName: recipient.firstName, lastName: recipient.lastName },
    ticket: {
      id: t.id,
      number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      departmentName: deptName,
    },
    ticketUrl,
    ...extra,
  };
}

export type TicketEvent =
  | {
      type: 'opened';
      ticket: TicketRow;
      reply: ReplyRow;
      byStaff: boolean;
      actorUserId?: string | null;
    }
  | {
      type: 'reply';
      ticket: TicketRow;
      reply: ReplyRow;
      byStaff: boolean;
      actorUserId?: string | null;
    }
  | { type: 'closed'; ticket: TicketRow; actorUserId?: string | null };

/**
 * Builds the `email:send` jobs for a ticket event. Callers enqueue them
 * (`enqueue('email', 'send', job)`); nothing is sent here.
 */
export async function ticketEmailJobs(
  db: Db,
  event: TicketEvent,
  settings: Settings,
  env: { appUrl?: string; webUrl?: string } = {},
): Promise<EmailSendJob[]> {
  const t = event.ticket;
  const u = urls(env);
  const deptName = await departmentName(db, t.departmentId);
  const jobs: EmailSendJob[] = [];
  const related = { type: 'ticket', id: t.id };
  const threadHeaders = {
    'In-Reply-To': `<ticket-${t.id}@provisia>`,
    References: `<ticket-${t.id}@provisia>`,
  };
  const requester = await ticketRequester(db, t);
  const authorName = event.type === 'closed' ? undefined : (event.reply.authorName ?? undefined);
  const message = event.type === 'closed' ? undefined : event.reply.body;

  const toClient = (
    key: 'ticket.opened' | 'ticket.reply' | 'ticket.closed',
    extra: Partial<TicketEmailData>,
  ) => {
    if (!requester) return;
    jobs.push({
      key,
      to: requester.email,
      toName: `${requester.firstName} ${requester.lastName}`.trim(),
      toUserId: requester.userId ?? undefined,
      cc: t.cc.length ? t.cc : undefined,
      locale: requester.language ?? settings['localization.defaultLocale'],
      data: ticketData(t, deptName, requester, u.portalTicket(t.id), extra) as unknown as Record<
        string,
        unknown
      >,
      related,
      departmentId: t.departmentId,
      headers: threadHeaders,
    });
  };
  const toStaff = async (extra: Partial<TicketEmailData>, exclude?: string | null) => {
    for (const r of await staffRecipients(db, t, settings, exclude)) {
      jobs.push({
        key: 'ticket.reply.staff',
        to: r.email,
        toName: `${r.firstName} ${r.lastName}`.trim(),
        toUserId: r.userId ?? undefined,
        locale: r.language ?? undefined,
        data: ticketData(t, deptName, r, u.adminTicket(t.id), extra) as unknown as Record<
          string,
          unknown
        >,
        related,
        headers: threadHeaders,
      });
    }
  };

  if (event.type === 'opened') {
    toClient('ticket.opened', { message, authorName });
    if (!event.byStaff) await toStaff({ message, authorName }, event.actorUserId);
  } else if (event.type === 'reply') {
    if (event.byStaff) toClient('ticket.reply', { message, authorName });
    else await toStaff({ message, authorName }, event.actorUserId);
  } else if (event.type === 'closed') {
    toClient('ticket.closed', {});
  }
  return jobs;
}

export interface CreateTicketInput {
  departmentId: string;
  subject: string;
  body: string;
  priority?: TicketPriority;
  clientId?: string | null;
  requesterEmail?: string | null;
  requesterName?: string | null;
  serviceId?: string | null;
  domainId?: string | null;
  cc?: string[];
  assignedToUserId?: string | null;
  author: { userId?: string | null; email?: string | null; name?: string | null; isStaff: boolean };
  source?: 'web' | 'email' | 'api';
  emailMessageId?: string | null;
  attachmentIds?: string[];
}

export async function createTicket(
  db: Db,
  input: CreateTicketInput,
): Promise<{ ticket: TicketRow; reply: ReplyRow }> {
  const number = await nextTicketNumber(db);
  const now = new Date();
  const [ticket] = await db
    .insert(tickets)
    .values({
      number,
      departmentId: input.departmentId,
      subject: input.subject.slice(0, 255),
      priority: input.priority ?? 'medium',
      clientId: input.clientId ?? null,
      requesterEmail: input.requesterEmail?.toLowerCase() ?? null,
      requesterName: input.requesterName ?? null,
      serviceId: input.serviceId ?? null,
      domainId: input.domainId ?? null,
      cc: input.cc ?? [],
      assignedToUserId: input.assignedToUserId ?? null,
      status: input.author.isStaff ? 'answered' : 'open',
      lastReplyAt: now,
      lastReplyBy: input.author.isStaff ? 'staff' : 'client',
      firstResponseAt: input.author.isStaff ? now : null,
    })
    .returning();
  if (!ticket) throw new Error('failed to insert ticket');
  const [reply] = await db
    .insert(ticketReplies)
    .values({
      ticketId: ticket.id,
      authorUserId: input.author.userId ?? null,
      authorEmail: input.author.email ?? null,
      authorName: input.author.name ?? null,
      isStaff: input.author.isStaff,
      body: input.body,
      source: input.source ?? 'web',
      emailMessageId: input.emailMessageId ?? null,
    })
    .returning();
  if (!reply) throw new Error('failed to insert ticket reply');
  if (input.attachmentIds?.length)
    await linkAttachments(db, ticket.id, reply.id, input.attachmentIds);
  return { ticket, reply };
}

export interface AddReplyInput {
  body: string;
  author: { userId?: string | null; email?: string | null; name?: string | null; isStaff: boolean };
  /** Explicit status (staff). Validated against the transition table. */
  status?: TicketStatus;
  source?: 'web' | 'email' | 'api';
  emailMessageId?: string | null;
  attachmentIds?: string[];
}

export async function addReply(
  db: Db,
  ticket: TicketRow,
  input: AddReplyInput,
): Promise<{ ticket: TicketRow; reply: ReplyRow }> {
  const by = input.author.isStaff ? 'staff' : 'client';
  let nextStatus = statusAfterReply(ticket.status, by);
  if (input.status && input.status !== nextStatus) {
    // Replying implicitly moves the status first; the explicit target must be reachable from there.
    if (!canTransition(nextStatus, input.status) && !canTransition(ticket.status, input.status)) {
      throw new TicketTransitionError(ticket.status, input.status);
    }
    nextStatus = input.status;
  }
  const now = new Date();
  const [reply] = await db
    .insert(ticketReplies)
    .values({
      ticketId: ticket.id,
      authorUserId: input.author.userId ?? null,
      authorEmail: input.author.email ?? null,
      authorName: input.author.name ?? null,
      isStaff: input.author.isStaff,
      body: input.body,
      source: input.source ?? 'web',
      emailMessageId: input.emailMessageId ?? null,
    })
    .returning();
  if (!reply) throw new Error('failed to insert ticket reply');
  if (input.attachmentIds?.length)
    await linkAttachments(db, ticket.id, reply.id, input.attachmentIds);
  const [updated] = await db
    .update(tickets)
    .set({
      status: nextStatus,
      lastReplyAt: now,
      lastReplyBy: by,
      firstResponseAt: ticket.firstResponseAt ?? (by === 'staff' ? now : null),
      closedAt: nextStatus === 'closed' ? now : null,
      escalatedAt: by === 'staff' ? null : ticket.escalatedAt,
    })
    .where(eq(tickets.id, ticket.id))
    .returning();
  if (!updated) throw new Error('ticket vanished');
  return { ticket: updated, reply };
}

/** Explicit status change (set status / close / reopen) with transition validation. */
export async function setTicketStatus(
  db: Db,
  ticket: TicketRow,
  status: TicketStatus,
): Promise<TicketRow> {
  if (!canTransition(ticket.status, status)) throw new TicketTransitionError(ticket.status, status);
  if (ticket.status === status) return ticket;
  const [updated] = await db
    .update(tickets)
    .set({ status, closedAt: status === 'closed' ? new Date() : null })
    .where(eq(tickets.id, ticket.id))
    .returning();
  if (!updated) throw new Error('ticket vanished');
  return updated;
}

export async function addNote(db: Db, ticketId: string, authorUserId: string | null, body: string) {
  const [note] = await db.insert(ticketNotes).values({ ticketId, authorUserId, body }).returning();
  if (!note) throw new Error('failed to insert note');
  return note;
}

async function linkAttachments(db: Db, ticketId: string, replyId: string, ids: string[]) {
  await db
    .update(ticketAttachments)
    .set({ replyId })
    .where(and(inArray(ticketAttachments.id, ids), eq(ticketAttachments.ticketId, ticketId)));
}

const SAFE_NAME = /[^a-zA-Z0-9._-]+/g;

/** Writes a file under `STORAGE_PATH/tickets/<ticketId>/` and returns the relative path. */
export async function storeTicketFile(
  ticketId: string,
  filename: string,
  content: Buffer,
  storageRoot: string = resolveStoragePath(),
): Promise<{ relativePath: string; absolutePath: string; safeName: string }> {
  const safeName = (path.basename(filename) || 'file').replace(SAFE_NAME, '_').slice(0, 120);
  const relativePath = path.posix.join(
    'tickets',
    ticketId,
    `${randomUUID().slice(0, 8)}-${safeName}`,
  );
  const absolutePath = path.join(storageRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return { relativePath, absolutePath, safeName };
}

export async function saveAttachmentRecord(
  db: Db,
  input: {
    ticketId: string;
    replyId?: string | null;
    uploadedByUserId?: string | null;
    name: string;
    path: string;
    size: number;
    mimeType: string;
  },
) {
  const [row] = await db
    .insert(ticketAttachments)
    .values({
      ticketId: input.ticketId,
      replyId: input.replyId ?? null,
      uploadedByUserId: input.uploadedByUserId ?? null,
      name: input.name,
      path: input.path,
      size: input.size,
      mimeType: input.mimeType.slice(0, 150),
    })
    .returning();
  if (!row) throw new Error('failed to insert attachment');
  return row;
}

/** Expands a canned response: `{{client.firstName}}`, `{{ticket.number}}`, `{{staff.firstName}}`, `{{company.name}}`. */
export function expandCannedResponse(
  body: string,
  ctx: {
    client?: { firstName: string; lastName?: string; companyName?: string | null } | null;
    ticket: { number: string; subject: string };
    staff: { firstName: string; lastName: string };
    company: { name: string };
  },
): string {
  return renderString(body, ctx as unknown as Record<string, unknown>, { plainText: true });
}

export { ticketSubjectToken };

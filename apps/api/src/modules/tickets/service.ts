import { createReadStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  cannedResponses,
  clients,
  type Db,
  type DepartmentMailboxConfig,
  domains,
  products,
  services,
  ticketAttachments,
  ticketDepartments,
  ticketNotes,
  ticketReplies,
  tickets,
  ticketWatchers,
  users,
} from '@provisia/db';
import {
  addNote,
  addReply,
  createTicket as coreCreateTicket,
  expandCannedResponse,
  setTicketStatus,
  type TicketEvent,
  type TicketRow,
  TicketTransitionError,
  testImap,
  ticketEmailJobs,
} from '@provisia/email';
import { decryptJson, encryptJson } from '@provisia/module-sdk';
import {
  type AuthUser,
  type CannedResponse,
  type CreateCannedResponse,
  type CreateTicket,
  type CreateTicketDepartment,
  type CreateTicketReply,
  type EmailSendJob,
  type Paginated,
  type PaginationQuery,
  pageOffset,
  paginate,
  type TicketAttachment,
  type TicketDepartment,
  type TicketDetail,
  type TicketListItem,
  type TicketListQuery,
  type TicketNote,
  type TicketReply,
  type TicketStatus,
  type UpdateTicket,
  type UpdateTicketDepartment,
} from '@provisia/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { getAllSettings } from '../../lib/settings.js';
import {
  assertUploadAllowed,
  contentDisposition,
  downloadContentType,
  ensureStorageDir,
  getUploadPolicy,
  randomStorageName,
  resolveStoragePath,
  sanitizeFilename,
} from '../../lib/uploads.js';

type CreateCanned = { departmentId?: string | null; title: string; body: string };

/* ============================================ departments ============================================ */

type DeptRow = typeof ticketDepartments.$inferSelect;

function deptView(row: DeptRow): TicketDepartment {
  let mailbox: TicketDepartment['mailbox'] = null;
  if (row.mailboxConfigEncrypted) {
    try {
      const cfg = decryptJson<DepartmentMailboxConfig>(row.mailboxConfigEncrypted);
      mailbox = {
        imap: cfg.imap
          ? {
              host: cfg.imap.host,
              port: cfg.imap.port,
              secure: cfg.imap.secure,
              user: cfg.imap.user,
              folder: cfg.imap.folder ?? null,
              processedFolder: cfg.imap.processedFolder ?? null,
              hasPassword: !!cfg.imap.password,
            }
          : null,
        smtp: cfg.smtp
          ? {
              host: cfg.smtp.host,
              port: cfg.smtp.port,
              secure: cfg.smtp.secure,
              user: cfg.smtp.user ?? null,
              hasPassword: !!cfg.smtp.password,
            }
          : null,
      };
    } catch {
      mailbox = null;
    }
  }
  const { mailboxConfigEncrypted: _omit, ...rest } = row;
  return { ...rest, mailbox };
}

export async function listDepartments(
  db: Db,
  opts: { includeHidden: boolean },
): Promise<TicketDepartment[]> {
  const rows = await db
    .select()
    .from(ticketDepartments)
    .where(opts.includeHidden ? undefined : eq(ticketDepartments.hidden, false))
    .orderBy(asc(ticketDepartments.sortOrder), asc(ticketDepartments.name));
  return rows.map(deptView);
}

export async function getDepartment(db: Db, id: string): Promise<TicketDepartment> {
  const [row] = await db
    .select()
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .limit(1);
  if (!row) throw notFound('Department');
  return deptView(row);
}

function mergeMailbox(
  existing: DepartmentMailboxConfig | null,
  input: CreateTicketDepartment['mailbox'],
): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const next: DepartmentMailboxConfig = {};
  if (input.imap === null) {
    // cleared
  } else if (input.imap) {
    const password = input.imap.password ?? existing?.imap?.password ?? '';
    if (!password) throw badRequest('IMAP password is required');
    next.imap = {
      host: input.imap.host,
      port: input.imap.port,
      secure: input.imap.secure,
      user: input.imap.user,
      password,
      folder: input.imap.folder || 'INBOX',
      processedFolder: input.imap.processedFolder ?? undefined,
    };
  } else if (existing?.imap) {
    next.imap = existing.imap;
  }
  if (input.smtp === null) {
    // cleared
  } else if (input.smtp) {
    next.smtp = {
      host: input.smtp.host,
      port: input.smtp.port,
      secure: input.smtp.secure,
      user: input.smtp.user ?? undefined,
      password: input.smtp.password ?? existing?.smtp?.password ?? undefined,
    };
  } else if (existing?.smtp) {
    next.smtp = existing.smtp;
  }
  return next.imap || next.smtp ? encryptJson(next) : null;
}

export async function createDepartment(
  db: Db,
  input: CreateTicketDepartment,
): Promise<TicketDepartment> {
  const { mailbox, ...fields } = input;
  const [row] = await db
    .insert(ticketDepartments)
    .values({
      ...fields,
      email: fields.email || null,
      description: fields.description ?? null,
      autoCloseDays: fields.autoCloseDays ?? null,
      escalationHours: fields.escalationHours ?? null,
      mailboxConfigEncrypted: mergeMailbox(null, mailbox) ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create department');
  return deptView(row);
}

export async function updateDepartment(
  db: Db,
  id: string,
  input: UpdateTicketDepartment,
): Promise<TicketDepartment> {
  const [existing] = await db
    .select()
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .limit(1);
  if (!existing) throw notFound('Department');
  const { mailbox, ...fields } = input;
  let current: DepartmentMailboxConfig | null = null;
  if (existing.mailboxConfigEncrypted) {
    try {
      current = decryptJson<DepartmentMailboxConfig>(existing.mailboxConfigEncrypted);
    } catch {
      current = null;
    }
  }
  const enc = mergeMailbox(current, mailbox);
  const [row] = await db
    .update(ticketDepartments)
    .set({
      ...fields,
      ...(fields.email !== undefined ? { email: fields.email || null } : {}),
      ...(enc !== undefined ? { mailboxConfigEncrypted: enc } : {}),
    })
    .where(eq(ticketDepartments.id, id))
    .returning();
  if (!row) throw notFound('Department');
  return deptView(row);
}

export async function deleteDepartment(db: Db, id: string): Promise<void> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.departmentId, id));
  if (n > 0) throw conflict('Department still has tickets; move them first', { tickets: n });
  const deleted = await db
    .delete(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .returning({ id: ticketDepartments.id });
  if (!deleted.length) throw notFound('Department');
}

export async function testDepartmentMailbox(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .limit(1);
  if (!row) throw notFound('Department');
  if (!row.mailboxConfigEncrypted) return { ok: false, message: 'No mailbox configured' };
  const cfg = decryptJson<DepartmentMailboxConfig>(row.mailboxConfigEncrypted);
  if (!cfg.imap) return { ok: false, message: 'No IMAP settings configured' };
  return testImap(cfg.imap);
}

/* ============================================ canned responses ============================================ */

export async function listCannedResponses(
  db: Db,
  departmentId?: string,
): Promise<CannedResponse[]> {
  return db
    .select()
    .from(cannedResponses)
    .where(
      departmentId
        ? or(isNull(cannedResponses.departmentId), eq(cannedResponses.departmentId, departmentId))
        : undefined,
    )
    .orderBy(asc(cannedResponses.title));
}

export async function createCannedResponse(db: Db, input: CreateCanned): Promise<CannedResponse> {
  const [row] = await db
    .insert(cannedResponses)
    .values({ departmentId: input.departmentId ?? null, title: input.title, body: input.body })
    .returning();
  if (!row) throw new Error('failed to create canned response');
  return row;
}

export async function updateCannedResponse(
  db: Db,
  id: string,
  input: Partial<CreateCannedResponse>,
): Promise<CannedResponse> {
  const [row] = await db
    .update(cannedResponses)
    .set(input)
    .where(eq(cannedResponses.id, id))
    .returning();
  if (!row) throw notFound('Canned response');
  return row;
}

export async function deleteCannedResponse(db: Db, id: string): Promise<void> {
  const rows = await db
    .delete(cannedResponses)
    .where(eq(cannedResponses.id, id))
    .returning({ id: cannedResponses.id });
  if (!rows.length) throw notFound('Canned response');
}

/** Renders a canned response for a ticket with the staff member's name and the client's details. */
export async function renderCannedResponse(
  db: Db,
  cannedId: string,
  ticket: TicketRow,
  staff: AuthUser,
): Promise<string> {
  const [c] = await db
    .select()
    .from(cannedResponses)
    .where(eq(cannedResponses.id, cannedId))
    .limit(1);
  if (!c) throw notFound('Canned response');
  const settings = await getAllSettings(db);
  let client: { firstName: string; lastName: string; companyName: string | null } | null = null;
  if (ticket.clientId) {
    const [row] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        companyName: clients.companyName,
      })
      .from(clients)
      .innerJoin(users, eq(users.id, clients.userId))
      .where(eq(clients.id, ticket.clientId))
      .limit(1);
    client = row ?? null;
  } else if (ticket.requesterName) {
    const [first = '', ...rest] = ticket.requesterName.split(' ');
    client = { firstName: first, lastName: rest.join(' '), companyName: null };
  }
  return expandCannedResponse(c.body, {
    client,
    ticket: { number: ticket.number, subject: ticket.subject },
    staff: { firstName: staff.firstName, lastName: staff.lastName },
    company: { name: settings['company.name'] },
  });
}

/* ============================================ tickets ============================================ */

export interface TicketScope {
  /** Portal: restrict to this client. */
  clientId?: string;
  /** Portal: hide internal replies, notes, watchers. */
  internal: boolean;
  /** For `assignedToUserId=me`. */
  userId?: string;
}

const PRIORITY_ORDER = sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

function listSelect() {
  return {
    ticket: tickets,
    departmentName: ticketDepartments.name,
    clientFirst: users.firstName,
    clientLast: users.lastName,
    clientCompany: clients.companyName,
  };
}

export async function listTickets(
  db: Db,
  q: TicketListQuery,
  scope: TicketScope,
): Promise<Paginated<TicketListItem>> {
  const where: SQL[] = [];
  if (scope.clientId) where.push(eq(tickets.clientId, scope.clientId));
  if (q.status) {
    const statuses = (Array.isArray(q.status) ? q.status : [q.status]) as TicketStatus[];
    where.push(inArray(tickets.status, statuses));
  } else if (!q.includeClosed) {
    where.push(ne(tickets.status, 'closed'));
  }
  if (q.departmentId) where.push(eq(tickets.departmentId, q.departmentId));
  if (q.clientId && !scope.clientId) where.push(eq(tickets.clientId, q.clientId));
  if (q.priority) where.push(eq(tickets.priority, q.priority));
  if (q.assignedToUserId === 'unassigned') where.push(isNull(tickets.assignedToUserId));
  else if (q.assignedToUserId === 'me' && scope.userId)
    where.push(eq(tickets.assignedToUserId, scope.userId));
  else if (q.assignedToUserId && q.assignedToUserId !== 'me')
    where.push(eq(tickets.assignedToUserId, q.assignedToUserId));
  if (q.search) {
    const term = `%${q.search.replace(/^#/, '')}%`;
    const s = or(
      ilike(tickets.subject, term),
      ilike(tickets.number, term),
      ilike(tickets.requesterEmail, term),
    );
    if (s) where.push(s);
  }
  if (!scope.internal) where.push(isNull(tickets.mergedIntoTicketId));
  const cond = where.length ? and(...where) : undefined;

  const orderCol =
    q.sort === 'createdAt'
      ? tickets.createdAt
      : q.sort === 'priority'
        ? PRIORITY_ORDER
        : sql`coalesce(${tickets.lastReplyAt}, ${tickets.createdAt})`;
  const [total] = await db.select({ n: count() }).from(tickets).where(cond);
  const rows = await db
    .select(listSelect())
    .from(tickets)
    .innerJoin(ticketDepartments, eq(ticketDepartments.id, tickets.departmentId))
    .leftJoin(clients, eq(clients.id, tickets.clientId))
    .leftJoin(users, eq(users.id, clients.userId))
    .where(cond)
    .orderBy(q.order === 'asc' ? asc(orderCol) : desc(orderCol), desc(tickets.createdAt))
    .limit(q.perPage)
    .offset(pageOffset(q));
  const items = await decorate(db, rows, scope);
  return paginate(items, total?.n ?? 0, q);
}

async function decorate(
  db: Db,
  rows: Array<{
    ticket: TicketRow;
    departmentName: string;
    clientFirst: string | null;
    clientLast: string | null;
    clientCompany: string | null;
  }>,
  scope: TicketScope,
): Promise<TicketListItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.ticket.id);
  const assigneeIds = [
    ...new Set(rows.map((r) => r.ticket.assignedToUserId).filter((x): x is string => !!x)),
  ];
  const assignees = assigneeIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, assigneeIds))
    : [];
  const counts = await db
    .select({ ticketId: ticketReplies.ticketId, n: count() })
    .from(ticketReplies)
    .where(
      and(
        inArray(ticketReplies.ticketId, ids),
        scope.internal ? undefined : eq(ticketReplies.internal, false),
      ),
    )
    .groupBy(ticketReplies.ticketId);
  const countMap = new Map(counts.map((c) => [c.ticketId, c.n]));
  const assigneeMap = new Map(assignees.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim()]));
  return rows.map((r) => ({
    ...r.ticket,
    departmentName: r.departmentName,
    clientName: r.ticket.clientId
      ? r.clientCompany || `${r.clientFirst ?? ''} ${r.clientLast ?? ''}`.trim() || null
      : r.ticket.requesterName || r.ticket.requesterEmail,
    assigneeName: r.ticket.assignedToUserId
      ? (assigneeMap.get(r.ticket.assignedToUserId) ?? null)
      : null,
    replyCount: countMap.get(r.ticket.id) ?? 0,
  }));
}

export async function loadTicket(db: Db, id: string, scope: TicketScope): Promise<TicketRow> {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!t) throw notFound('Ticket');
  if (scope.clientId && t.clientId !== scope.clientId) throw notFound('Ticket');
  return t;
}

function attachmentView(a: typeof ticketAttachments.$inferSelect): TicketAttachment {
  const { path: _p, ...rest } = a;
  return rest;
}

export async function getTicket(db: Db, id: string, scope: TicketScope): Promise<TicketDetail> {
  const t = await loadTicket(db, id, scope);
  const [row] = await db
    .select(listSelect())
    .from(tickets)
    .innerJoin(ticketDepartments, eq(ticketDepartments.id, tickets.departmentId))
    .leftJoin(clients, eq(clients.id, tickets.clientId))
    .leftJoin(users, eq(users.id, clients.userId))
    .where(eq(tickets.id, t.id))
    .limit(1);
  if (!row) throw notFound('Ticket');
  const [item] = await decorate(db, [row], scope);
  if (!item) throw notFound('Ticket');

  const replyRows = await db
    .select()
    .from(ticketReplies)
    .where(
      and(
        eq(ticketReplies.ticketId, t.id),
        scope.internal ? undefined : eq(ticketReplies.internal, false),
      ),
    )
    .orderBy(asc(ticketReplies.createdAt));
  const files = await db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, t.id))
    .orderBy(asc(ticketAttachments.createdAt));
  const replies: TicketReply[] = replyRows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    authorUserId: r.authorUserId,
    authorEmail: scope.internal ? r.authorEmail : null,
    authorName: r.authorName,
    isStaff: r.isStaff,
    internal: r.internal,
    body: r.body,
    source: r.source,
    attachments: files.filter((f) => f.replyId === r.id).map(attachmentView),
    createdAt: r.createdAt,
  }));

  let notes: TicketNote[] = [];
  let watchers: TicketDetail['watchers'] = [];
  if (scope.internal) {
    const noteRows = await db
      .select({ note: ticketNotes, firstName: users.firstName, lastName: users.lastName })
      .from(ticketNotes)
      .leftJoin(users, eq(users.id, ticketNotes.authorUserId))
      .where(eq(ticketNotes.ticketId, t.id))
      .orderBy(asc(ticketNotes.createdAt));
    notes = noteRows.map((n) => ({
      ...n.note,
      authorName: n.firstName ? `${n.firstName} ${n.lastName ?? ''}`.trim() : null,
    }));
    watchers = await db
      .select({
        userId: ticketWatchers.userId,
        name: sql<string>`trim(${users.firstName} || ' ' || ${users.lastName})`,
        email: users.email,
      })
      .from(ticketWatchers)
      .innerJoin(users, eq(users.id, ticketWatchers.userId))
      .where(eq(ticketWatchers.ticketId, t.id));
  }

  let service: TicketDetail['service'] = null;
  if (t.serviceId) {
    const [s] = await db
      .select({
        id: services.id,
        domain: services.domain,
        username: services.username,
        productName: products.name,
      })
      .from(services)
      .innerJoin(products, eq(products.id, services.productId))
      .where(eq(services.id, t.serviceId))
      .limit(1);
    if (s)
      service = {
        id: s.id,
        label: `${s.productName}${s.domain ? ` — ${s.domain}` : s.username ? ` — ${s.username}` : ''}`,
      };
  }
  let domain: TicketDetail['domain'] = null;
  if (t.domainId) {
    const [d] = await db
      .select({ id: domains.id, name: domains.name })
      .from(domains)
      .where(eq(domains.id, t.domainId))
      .limit(1);
    if (d) domain = d;
  }

  return {
    ...item,
    replies,
    notes,
    attachments: scope.internal
      ? files.map(attachmentView)
      : files
          .filter((f) => replies.some((r) => r.id === f.replyId) || !f.replyId)
          .map(attachmentView),
    watchers,
    service,
    domain,
  };
}

/** Verifies a service / domain belongs to the client (portal) or exists (admin). */
async function assertReferences(
  db: Db,
  input: { serviceId?: string | null; domainId?: string | null },
  clientId: string | null | undefined,
) {
  if (input.serviceId) {
    const [s] = await db
      .select({ clientId: services.clientId })
      .from(services)
      .where(eq(services.id, input.serviceId))
      .limit(1);
    if (!s || (clientId && s.clientId !== clientId)) throw badRequest('Unknown service');
  }
  if (input.domainId) {
    const [d] = await db
      .select({ clientId: domains.clientId })
      .from(domains)
      .where(eq(domains.id, input.domainId))
      .limit(1);
    if (!d || (clientId && d.clientId !== clientId)) throw badRequest('Unknown domain');
  }
}

async function assertDepartmentSelectable(db: Db, id: string, staff: boolean) {
  const [d] = await db
    .select({ hidden: ticketDepartments.hidden })
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, id))
    .limit(1);
  if (!d || (!staff && d.hidden)) throw badRequest('Unknown department');
}

async function emailsFor(
  db: Db,
  event: TicketEvent,
  env: { appUrl: string; webUrl: string },
): Promise<EmailSendJob[]> {
  const settings = await getAllSettings(db);
  return ticketEmailJobs(db, event, settings, env);
}

export interface Env {
  appUrl: string;
  webUrl: string;
}

export async function createTicket(db: Db, input: CreateTicket, actor: AuthUser, env: Env) {
  const staff = actor.role !== 'client';
  const clientId = staff ? (input.clientId ?? null) : actor.clientId;
  if (!staff && !clientId) throw forbidden('No client account');
  if (staff && !clientId && !input.requesterEmail)
    throw badRequest('clientId or requesterEmail is required');
  await assertDepartmentSelectable(db, input.departmentId, staff);
  await assertReferences(db, input, clientId);
  if (clientId) {
    const [c] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!c) throw badRequest('Unknown client');
  }
  if (input.attachmentIds.length) await assertStagedAttachments(db, input.attachmentIds, actor.id);
  const { ticket, reply } = await coreCreateTicket(db, {
    departmentId: input.departmentId,
    subject: input.subject,
    body: input.body,
    priority: input.priority,
    clientId,
    requesterEmail: clientId ? null : (input.requesterEmail ?? null),
    requesterName: clientId ? null : (input.requesterName ?? null),
    serviceId: input.serviceId ?? null,
    domainId: input.domainId ?? null,
    cc: input.cc,
    assignedToUserId: staff ? (input.assignedToUserId ?? null) : null,
    author: {
      userId: actor.id,
      email: actor.email,
      name: `${actor.firstName} ${actor.lastName}`.trim(),
      isStaff: staff,
    },
    source: 'web',
  });
  if (input.attachmentIds.length)
    await claimAttachments(db, ticket.id, reply.id, input.attachmentIds);
  const emails = await emailsFor(
    db,
    { type: 'opened', ticket, reply, byStaff: staff, actorUserId: actor.id },
    env,
  );
  return { ticket, reply, emails };
}

export async function replyToTicket(
  db: Db,
  id: string,
  input: CreateTicketReply,
  actor: AuthUser,
  scope: TicketScope,
  env: Env,
) {
  const staff = actor.role !== 'client';
  const t = await loadTicket(db, id, scope);
  if (t.mergedIntoTicketId)
    throw conflict('Ticket was merged into another ticket', {
      mergedIntoTicketId: t.mergedIntoTicketId,
    });
  if (!staff && input.status && input.status !== 'closed')
    throw forbidden('Clients can only close tickets');
  if (!staff && input.internalNote) throw forbidden();
  let body = input.body;
  if (staff && input.cannedResponseId) {
    const canned = await renderCannedResponse(db, input.cannedResponseId, t, actor);
    body = body.trim() ? `${canned}\n\n${body}` : canned;
  }
  if (input.attachmentIds.length)
    await assertStagedAttachments(db, input.attachmentIds, actor.id, t.id);
  try {
    const { ticket, reply } = await addReply(db, t, {
      body,
      author: {
        userId: actor.id,
        email: actor.email,
        name: `${actor.firstName} ${actor.lastName}`.trim(),
        isStaff: staff,
      },
      status: input.status,
      source: 'web',
    });
    if (input.attachmentIds.length)
      await claimAttachments(db, ticket.id, reply.id, input.attachmentIds);
    let note: TicketNote | null = null;
    if (staff && input.internalNote?.trim()) {
      const n = await addNote(db, ticket.id, actor.id, input.internalNote);
      note = { ...n, authorName: `${actor.firstName} ${actor.lastName}`.trim() };
    }
    const emails = await emailsFor(
      db,
      { type: 'reply', ticket, reply, byStaff: staff, actorUserId: actor.id },
      env,
    );
    if (ticket.status === 'closed' && t.status !== 'closed')
      emails.push(...(await emailsFor(db, { type: 'closed', ticket, actorUserId: actor.id }, env)));
    return { ticket, reply, note, emails };
  } catch (err) {
    if (err instanceof TicketTransitionError)
      throw new AppError('invalid_transition', err.message, 409, { from: err.from, to: err.to });
    throw err;
  }
}

export async function updateTicket(
  db: Db,
  id: string,
  input: UpdateTicket,
  actor: AuthUser,
  env: Env,
) {
  const t = await loadTicket(db, id, { internal: true });
  const { status, ...fields } = input;
  if (fields.departmentId) await assertDepartmentSelectable(db, fields.departmentId, true);
  await assertReferences(db, fields, fields.clientId ?? t.clientId);
  if (fields.assignedToUserId) {
    const [u] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, fields.assignedToUserId))
      .limit(1);
    if (!u || u.role === 'client') throw badRequest('Assignee must be a staff user');
  }
  let updated = t;
  if (Object.keys(fields).length) {
    const [row] = await db.update(tickets).set(fields).where(eq(tickets.id, id)).returning();
    if (!row) throw notFound('Ticket');
    updated = row;
  }
  const emails: EmailSendJob[] = [];
  if (status && status !== updated.status) {
    try {
      updated = await setTicketStatus(db, updated, status);
    } catch (err) {
      if (err instanceof TicketTransitionError)
        throw new AppError('invalid_transition', err.message, 409, { from: err.from, to: err.to });
      throw err;
    }
    if (status === 'closed')
      emails.push(
        ...(await emailsFor(db, { type: 'closed', ticket: updated, actorUserId: actor.id }, env)),
      );
  }
  return { ticket: updated, before: t, emails };
}

export async function closeTicket(
  db: Db,
  id: string,
  actor: AuthUser,
  scope: TicketScope,
  env: Env,
) {
  const t = await loadTicket(db, id, scope);
  if (t.status === 'closed') return { ticket: t, emails: [] as EmailSendJob[] };
  const ticket = await setTicketStatus(db, t, 'closed');
  return {
    ticket,
    emails: await emailsFor(db, { type: 'closed', ticket, actorUserId: actor.id }, env),
  };
}

export async function reopenTicket(db: Db, id: string, scope: TicketScope) {
  const t = await loadTicket(db, id, scope);
  if (t.mergedIntoTicketId) throw conflict('Merged tickets cannot be reopened');
  if (t.status !== 'closed')
    throw new AppError('invalid_transition', 'Ticket is not closed', 409, {
      from: t.status,
      to: 'open',
    });
  return setTicketStatus(db, t, 'open');
}

/** Moves replies/attachments/notes of `sourceIds` into `targetId`; sources are closed and pointed at the target. */
export async function mergeTickets(db: Db, targetId: string, sourceIds: string[], actor: AuthUser) {
  const target = await loadTicket(db, targetId, { internal: true });
  const ids = sourceIds.filter((s) => s !== targetId);
  if (!ids.length) throw badRequest('Nothing to merge');
  const sources = await db.select().from(tickets).where(inArray(tickets.id, ids));
  if (sources.length !== ids.length) throw notFound('Ticket');
  for (const s of sources) {
    if (s.clientId && target.clientId && s.clientId !== target.clientId)
      throw conflict(`Ticket #${s.number} belongs to another client`);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(ticketReplies)
      .set({ ticketId: targetId })
      .where(inArray(ticketReplies.ticketId, ids));
    await tx
      .update(ticketAttachments)
      .set({ ticketId: targetId })
      .where(inArray(ticketAttachments.ticketId, ids));
    await tx
      .update(ticketNotes)
      .set({ ticketId: targetId })
      .where(inArray(ticketNotes.ticketId, ids));
    for (const s of sources) {
      await tx.insert(ticketNotes).values({
        ticketId: targetId,
        authorUserId: actor.id,
        body: `Merged ticket #${s.number} "${s.subject}" into this ticket.`,
      });
      await tx
        .update(tickets)
        .set({ status: 'closed', closedAt: new Date(), mergedIntoTicketId: targetId })
        .where(eq(tickets.id, s.id));
    }
    const lastReply = sources.reduce<Date | null>(
      (acc, s) => (s.lastReplyAt && (!acc || s.lastReplyAt > acc) ? s.lastReplyAt : acc),
      target.lastReplyAt,
    );
    await tx.update(tickets).set({ lastReplyAt: lastReply }).where(eq(tickets.id, targetId));
  });
  return loadTicket(db, targetId, { internal: true });
}

/* ------------------------------------------- notes & watchers ------------------------------------------- */

export async function createNote(
  db: Db,
  ticketId: string,
  actor: AuthUser,
  body: string,
): Promise<TicketNote> {
  await loadTicket(db, ticketId, { internal: true });
  const n = await addNote(db, ticketId, actor.id, body);
  return { ...n, authorName: `${actor.firstName} ${actor.lastName}`.trim() };
}

export async function deleteNote(db: Db, ticketId: string, noteId: string): Promise<void> {
  const rows = await db
    .delete(ticketNotes)
    .where(and(eq(ticketNotes.id, noteId), eq(ticketNotes.ticketId, ticketId)))
    .returning({ id: ticketNotes.id });
  if (!rows.length) throw notFound('Note');
}

export async function addWatcher(db: Db, ticketId: string, userId: string) {
  await loadTicket(db, ticketId, { internal: true });
  const [u] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || u.role === 'client') throw badRequest('Watcher must be a staff user');
  await db.insert(ticketWatchers).values({ ticketId, userId }).onConflictDoNothing();
}

export async function removeWatcher(db: Db, ticketId: string, userId: string) {
  await db
    .delete(ticketWatchers)
    .where(and(eq(ticketWatchers.ticketId, ticketId), eq(ticketWatchers.userId, userId)));
}

/* ------------------------------------------- attachments ------------------------------------------- */

/**
 * Uploads are staged with `ticket_id` = the ticket they are for, or (for a new ticket) a placeholder row
 * is not possible because of the FK; so staging for new tickets stores the file under `tickets/_staging`
 * and keeps the record in memory of the caller via `attachmentIds` on create. To keep it simple and
 * FK-safe, new-ticket uploads require the ticket to exist first: the UI creates the ticket, then uploads
 * to `/tickets/:id/attachments` and links them to the first reply. Reply uploads work the same way.
 */
export async function uploadAttachment(
  db: Db,
  ticketId: string,
  file: { filename: string; mimetype: string; stream: NodeJS.ReadableStream },
  actor: AuthUser,
  scope: TicketScope,
): Promise<TicketAttachment> {
  const t = await loadTicket(db, ticketId, scope);
  if (actor.role === 'client') {
    const s = await getAllSettings(db);
    if (!s['support.allowClientAttachments']) throw forbidden('Attachments are disabled');
  }
  const policy = await getUploadPolicy(db);
  assertUploadAllowed(policy, { filename: file.filename, mimetype: file.mimetype });
  const dir = await ensureStorageDir(policy.root, 'tickets', t.id);
  const storedName = randomStorageName(file.filename);
  const abs = resolveStoragePath(dir, storedName);
  const buf = await readLimited(file.stream, policy.maxBytes);
  await writeFile(abs, buf);
  const [row] = await db
    .insert(ticketAttachments)
    .values({
      ticketId: t.id,
      uploadedByUserId: actor.id,
      name: sanitizeFilename(file.filename),
      path: path.posix.join('tickets', t.id, storedName),
      size: buf.length,
      mimeType: file.mimetype.slice(0, 150),
    })
    .returning();
  if (!row) throw new Error('failed to insert attachment');
  return attachmentView(row);
}

async function readLimited(stream: NodeJS.ReadableStream, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += b.length;
    if (size > max) {
      (stream as { resume?: () => void }).resume?.();
      throw new AppError('payload_too_large', `File exceeds the maximum size of ${max} bytes`, 413);
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** Staged = uploaded to this ticket by this user and not yet linked to a reply. */
async function assertStagedAttachments(db: Db, ids: string[], userId: string, ticketId?: string) {
  const rows = await db
    .select({
      id: ticketAttachments.id,
      ticketId: ticketAttachments.ticketId,
      replyId: ticketAttachments.replyId,
      by: ticketAttachments.uploadedByUserId,
    })
    .from(ticketAttachments)
    .where(inArray(ticketAttachments.id, ids));
  if (rows.length !== ids.length) throw badRequest('Unknown attachment');
  for (const r of rows) {
    if (r.replyId || r.by !== userId || (ticketId && r.ticketId !== ticketId))
      throw badRequest('Attachment cannot be linked');
  }
}

async function claimAttachments(db: Db, ticketId: string, replyId: string, ids: string[]) {
  await db
    .update(ticketAttachments)
    .set({ replyId, ticketId })
    .where(inArray(ticketAttachments.id, ids));
}

export async function openAttachment(
  db: Db,
  ticketId: string,
  attachmentId: string,
  scope: TicketScope,
) {
  await loadTicket(db, ticketId, scope);
  const [a] = await db
    .select({ att: ticketAttachments, internal: ticketReplies.internal })
    .from(ticketAttachments)
    .leftJoin(ticketReplies, eq(ticketReplies.id, ticketAttachments.replyId))
    .where(and(eq(ticketAttachments.id, attachmentId), eq(ticketAttachments.ticketId, ticketId)))
    .limit(1);
  if (!a || (!scope.internal && a.internal)) throw notFound('Attachment');
  const policy = await getUploadPolicy(db);
  const abs = resolveStoragePath(policy.root, ...a.att.path.split('/'));
  try {
    await stat(abs);
  } catch {
    throw notFound('Attachment file');
  }
  return {
    stream: createReadStream(abs),
    mimeType: downloadContentType(a.att.mimeType),
    size: a.att.size,
    disposition: contentDisposition(a.att.name),
  };
}

export async function deleteAttachment(
  db: Db,
  ticketId: string,
  attachmentId: string,
): Promise<void> {
  const [a] = await db
    .select()
    .from(ticketAttachments)
    .where(and(eq(ticketAttachments.id, attachmentId), eq(ticketAttachments.ticketId, ticketId)))
    .limit(1);
  if (!a) throw notFound('Attachment');
  await db.delete(ticketAttachments).where(eq(ticketAttachments.id, a.id));
  const policy = await getUploadPolicy(db);
  await unlink(resolveStoragePath(policy.root, ...a.path.split('/'))).catch(() => {});
}

export type { PaginationQuery };

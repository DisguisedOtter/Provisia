import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const ticketStatusSchema = z.enum([
  'open',
  'answered',
  'customer_reply',
  'on_hold',
  'closed',
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

/**
 * Allowed explicit status changes (staff "set status", reopen, close). Replies move the status
 * implicitly: a client reply → `customer_reply` (or stays `open`), a staff reply → `answered`.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['answered', 'on_hold', 'closed'],
  answered: ['open', 'customer_reply', 'on_hold', 'closed'],
  customer_reply: ['open', 'answered', 'on_hold', 'closed'],
  on_hold: ['open', 'answered', 'closed'],
  closed: ['open'],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return from === to || TICKET_TRANSITIONS[from].includes(to);
}

/** Status after a reply, given who wrote it. */
export function statusAfterReply(current: TicketStatus, by: 'client' | 'staff'): TicketStatus {
  if (by === 'staff') return 'answered';
  return current === 'open' ? 'open' : 'customer_reply';
}

/** `1001` → `#1001`; also used to build the subject token `[#1001]`. */
export function formatTicketNumber(number: string | number): string {
  return `#${number}`;
}
export function ticketSubjectToken(number: string | number): string {
  return `[#${number}]`;
}
/** Extracts the ticket number from a subject such as `Re: [#1001] Help`; null when absent. */
export function parseTicketNumber(subject: string | null | undefined): string | null {
  const m = /\[#\s*(\d{1,20})\s*\]/.exec(subject ?? '');
  return m?.[1] ?? null;
}

export const unknownSenderPolicySchema = z.enum(['inherit', 'guest', 'reject']);
export type UnknownSenderPolicy = z.infer<typeof unknownSenderPolicySchema>;

/* ---------------------------------------- departments ---------------------------------------- */

export const ticketDepartmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
  description: z.string().nullable(),
  hidden: z.boolean(),
  sortOrder: z.number().int(),
  imapEnabled: z.boolean(),
  unknownSenderPolicy: unknownSenderPolicySchema,
  autoCloseDays: z.number().int().nullable(),
  escalationHours: z.number().int().nullable(),
  /** Non-secret view of the mailbox config (admin only; portal gets the public subset). */
  mailbox: z
    .object({
      imap: z
        .object({
          host: z.string(),
          port: z.number().int(),
          secure: z.boolean(),
          user: z.string(),
          folder: z.string().nullable(),
          processedFolder: z.string().nullable(),
          hasPassword: z.boolean(),
        })
        .nullable(),
      smtp: z
        .object({
          host: z.string(),
          port: z.number().int(),
          secure: z.boolean(),
          user: z.string().nullable(),
          hasPassword: z.boolean(),
        })
        .nullable(),
    })
    .nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TicketDepartment = z.infer<typeof ticketDepartmentSchema>;

/** What clients see when choosing a department. */
export const publicTicketDepartmentSchema = ticketDepartmentSchema.pick({
  id: true,
  name: true,
  description: true,
  sortOrder: true,
});
export type PublicTicketDepartment = z.infer<typeof publicTicketDepartmentSchema>;

export const mailboxImapInputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  user: z.string().min(1).max(255),
  /** Omit to keep the stored password. */
  password: z.string().max(500).optional(),
  folder: z.string().max(200).default('INBOX'),
  processedFolder: z.string().max(200).nullable().optional(),
});
export const mailboxSmtpInputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().max(255).nullable().optional(),
  password: z.string().max(500).optional(),
});

export const createTicketDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
  email: z
    .union([emailSchema, z.literal('')])
    .nullable()
    .optional(),
  description: z.string().max(2000).nullable().optional(),
  hidden: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  imapEnabled: z.boolean().default(false),
  unknownSenderPolicy: unknownSenderPolicySchema.default('inherit'),
  autoCloseDays: z.number().int().min(0).max(365).nullable().optional(),
  escalationHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .nullable()
    .optional(),
  /** `null` clears the mailbox config. */
  mailbox: z
    .object({
      imap: mailboxImapInputSchema.nullable().optional(),
      smtp: mailboxSmtpInputSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type CreateTicketDepartment = z.infer<typeof createTicketDepartmentSchema>;
export const updateTicketDepartmentSchema = createTicketDepartmentSchema.partial();
export type UpdateTicketDepartment = z.infer<typeof updateTicketDepartmentSchema>;

/* ---------------------------------------- tickets ---------------------------------------- */

export const ticketAttachmentSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  replyId: uuidSchema.nullable(),
  uploadedByUserId: uuidSchema.nullable(),
  name: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
  createdAt: timestampSchema,
});
export type TicketAttachment = z.infer<typeof ticketAttachmentSchema>;

export const ticketSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  clientId: uuidSchema.nullable(),
  departmentId: uuidSchema,
  assignedToUserId: uuidSchema.nullable(),
  serviceId: uuidSchema.nullable(),
  domainId: uuidSchema.nullable(),
  subject: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  requesterEmail: z.string().nullable(),
  requesterName: z.string().nullable(),
  cc: z.array(z.string()),
  firstResponseAt: timestampSchema.nullable(),
  lastReplyAt: timestampSchema.nullable(),
  lastReplyBy: z.string().nullable(),
  mergedIntoTicketId: uuidSchema.nullable(),
  escalatedAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Ticket = z.infer<typeof ticketSchema>;

/** List rows carry a few denormalised labels so the UI needs no extra lookups. */
export const ticketListItemSchema = ticketSchema.extend({
  departmentName: z.string(),
  clientName: z.string().nullable(),
  assigneeName: z.string().nullable(),
  replyCount: z.number().int(),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

export const ticketReplySchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  authorUserId: uuidSchema.nullable(),
  authorEmail: z.string().nullable(),
  authorName: z.string().nullable(),
  isStaff: z.boolean(),
  internal: z.boolean(),
  body: z.string(),
  source: z.string(),
  attachments: z.array(ticketAttachmentSchema),
  createdAt: timestampSchema,
});
export type TicketReply = z.infer<typeof ticketReplySchema>;

export const ticketNoteSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  authorUserId: uuidSchema.nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TicketNote = z.infer<typeof ticketNoteSchema>;

export const ticketWatcherSchema = z.object({
  userId: uuidSchema,
  name: z.string(),
  email: z.string(),
});
export type TicketWatcher = z.infer<typeof ticketWatcherSchema>;

/** Full ticket as returned by GET; the portal variant omits notes, watchers and internal replies. */
export const ticketDetailSchema = ticketListItemSchema.extend({
  replies: z.array(ticketReplySchema),
  notes: z.array(ticketNoteSchema),
  attachments: z.array(ticketAttachmentSchema),
  watchers: z.array(ticketWatcherSchema),
  service: z.object({ id: uuidSchema, label: z.string() }).nullable(),
  domain: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketListQuerySchema = paginationQuerySchema.extend({
  status: z
    .union([ticketStatusSchema, z.string().transform((s) => s.split(',').filter(Boolean))])
    .optional(),
  departmentId: uuidSchema.optional(),
  assignedToUserId: z.union([uuidSchema, z.literal('unassigned'), z.literal('me')]).optional(),
  clientId: uuidSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  /** Matches number, subject, requester email. */
  search: z.string().max(200).optional(),
  /** Default: everything except closed. Pass `includeClosed=true` or an explicit status. */
  includeClosed: z.coerce.boolean().optional(),
  sort: z.enum(['lastReplyAt', 'createdAt', 'priority']).default('lastReplyAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

export const createTicketSchema = z.object({
  departmentId: uuidSchema,
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(50_000),
  priority: ticketPrioritySchema.default('medium'),
  serviceId: uuidSchema.nullable().optional(),
  domainId: uuidSchema.nullable().optional(),
  cc: z.array(emailSchema).max(5).default([]),
  /** Previously uploaded attachment ids to link to the first message. */
  attachmentIds: z.array(uuidSchema).max(10).default([]),
  /** Admin only ("open on behalf of"); portal derives it from the session. */
  clientId: uuidSchema.optional(),
  requesterEmail: emailSchema.optional(),
  requesterName: z.string().max(200).optional(),
  /** Admin only: assign immediately. */
  assignedToUserId: uuidSchema.nullable().optional(),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const createTicketReplySchema = z.object({
  body: z.string().min(1).max(50_000),
  attachmentIds: z.array(uuidSchema).max(10).default([]),
  /** Staff only: also add an internal note in the same action. */
  internalNote: z.string().max(50_000).optional(),
  /** Staff only: status after the reply (default `answered`); clients can only `closed`. */
  status: ticketStatusSchema.optional(),
  /** Staff only: expand this canned response (placeholders rendered) and prepend it to `body` if body is empty. */
  cannedResponseId: uuidSchema.optional(),
});
export type CreateTicketReply = z.infer<typeof createTicketReplySchema>;

export const updateTicketSchema = z.object({
  subject: z.string().min(1).max(255).optional(),
  priority: ticketPrioritySchema.optional(),
  departmentId: uuidSchema.optional(),
  assignedToUserId: uuidSchema.nullable().optional(),
  status: ticketStatusSchema.optional(),
  serviceId: uuidSchema.nullable().optional(),
  domainId: uuidSchema.nullable().optional(),
  cc: z.array(emailSchema).max(5).optional(),
  clientId: uuidSchema.nullable().optional(),
});
export type UpdateTicket = z.infer<typeof updateTicketSchema>;

export const assignTicketSchema = z.object({ assignedToUserId: uuidSchema.nullable() });
export const setTicketStatusSchema = z.object({ status: ticketStatusSchema });
export const mergeTicketsSchema = z.object({
  /** Tickets to merge into the target (path id). Their replies move over; they are closed. */
  sourceTicketIds: z.array(uuidSchema).min(1).max(20),
});
export const createTicketNoteSchema = z.object({ body: z.string().min(1).max(50_000) });
export const addWatcherSchema = z.object({ userId: uuidSchema });

/* ---------------------------------------- canned responses ---------------------------------------- */

export const cannedResponseSchema = z.object({
  id: uuidSchema,
  departmentId: uuidSchema.nullable(),
  title: z.string(),
  body: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CannedResponse = z.infer<typeof cannedResponseSchema>;

export const createCannedResponseSchema = z.object({
  departmentId: uuidSchema.nullable().optional(),
  title: z.string().min(1).max(150),
  /** Handlebars: `{{client.firstName}}`, `{{ticket.number}}`, `{{staff.firstName}}`, `{{company.name}}`. */
  body: z.string().min(1).max(50_000),
});
export type CreateCannedResponse = z.infer<typeof createCannedResponseSchema>;
export const updateCannedResponseSchema = createCannedResponseSchema.partial();
export type UpdateCannedResponse = z.infer<typeof updateCannedResponseSchema>;

/** Upload limits applied by the API; mirrored in the portal/admin UI. */
export const TICKET_ATTACHMENT_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

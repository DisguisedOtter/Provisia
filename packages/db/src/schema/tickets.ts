import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';
import { users } from './auth.js';
import { clients } from './clients.js';
import { domains } from './domains.js';
import { services } from './services.js';

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'answered',
  'customer_reply',
  'on_hold',
  'closed',
]);

export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'urgent']);

/** What to do with inbound mail from an address that is not a known client/contact. */
export const unknownSenderPolicyEnum = pgEnum('unknown_sender_policy', [
  'inherit',
  'guest',
  'reject',
]);

/** Human ticket numbers: `nextval('ticket_number_seq')` → 1001, 1002, ... */
export const ticketNumberSeq = pgSequence('ticket_number_seq', { startWith: 1001, increment: 1 });

/** Decrypted shape of `ticket_departments.mailbox_config_encrypted`. */
export type DepartmentMailboxConfig = {
  imap?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    /** Folder to poll, default `INBOX`. */
    folder?: string;
    /** Move processed messages here; when empty they are only flagged `\Seen`. */
    processedFolder?: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
};

export const ticketDepartments = pgTable('ticket_departments', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  /** Outgoing address and IMAP ingest mailbox for this department. */
  email: varchar('email', { length: 255 }),
  description: text('description'),
  /** Only staff can see/select hidden departments (e.g. internal). */
  hidden: boolean('hidden').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  /** When true the worker polls the IMAP mailbox in `mailbox_config_encrypted` every 2 minutes. */
  imapEnabled: boolean('imap_enabled').notNull().default(false),
  /** AES-256-GCM encrypted JSON (`DepartmentMailboxConfig`). Never returned by the API. */
  mailboxConfigEncrypted: text('mailbox_config_encrypted'),
  unknownSenderPolicy: unknownSenderPolicyEnum('unknown_sender_policy')
    .notNull()
    .default('inherit'),
  /** Overrides `support.autoCloseDays`; null = inherit the global setting. */
  autoCloseDays: integer('auto_close_days'),
  /** Overrides `support.escalationHours`; null = inherit the global setting. */
  escalationHours: integer('escalation_hours'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Legacy inline attachment shape kept on `ticket_replies.attachments`; new uploads go to `ticket_attachments`. */
export type TicketAttachment = { name: string; path: string; size: number; mimeType: string };

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    /** Human-friendly ticket number shown in subjects as `[#1001]`; sourced from `ticket_number_seq`. */
    number: varchar('number', { length: 20 }).notNull().unique(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => ticketDepartments.id, { onDelete: 'restrict' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Optional reference to the service / domain the ticket is about. */
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    subject: varchar('subject', { length: 255 }).notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),
    priority: ticketPriorityEnum('priority').notNull().default('medium'),
    /** For tickets opened by email from unknown senders. */
    requesterEmail: varchar('requester_email', { length: 255 }),
    requesterName: varchar('requester_name', { length: 200 }),
    /** Extra addresses that receive client-facing notifications. */
    cc: jsonb('cc').$type<string[]>().notNull().default([]),
    /** SLA-ish timestamps. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    /** `client` | `staff` — who wrote the last non-internal reply. */
    lastReplyBy: varchar('last_reply_by', { length: 10 }),
    /** Set when this ticket was merged into another one (status becomes `closed`). */
    mergedIntoTicketId: uuid('merged_into_ticket_id'),
    /** Set once the escalation email has been sent, so it is not sent again. */
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_client_idx').on(t.clientId),
    index('tickets_department_status_idx').on(t.departmentId, t.status),
    index('tickets_assignee_idx').on(t.assignedToUserId),
    index('tickets_status_last_reply_idx').on(t.status, t.lastReplyAt),
  ],
);

export const ticketReplies = pgTable(
  'ticket_replies',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Null for replies that arrived by email from a non-user. */
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorEmail: varchar('author_email', { length: 255 }),
    authorName: varchar('author_name', { length: 200 }),
    isStaff: boolean('is_staff').notNull().default(false),
    /** Staff-only notes are never shown to the client (see also `ticket_notes`). */
    internal: boolean('internal').notNull().default(false),
    body: text('body').notNull(),
    attachments: jsonb('attachments').$type<TicketAttachment[]>().notNull().default([]),
    /** Message-ID of the ingested email, for threading and de-duplication. */
    emailMessageId: varchar('email_message_id', { length: 255 }),
    /** `web` | `email` | `api`. */
    source: varchar('source', { length: 10 }).notNull().default('web'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_replies_ticket_idx').on(t.ticketId),
    index('ticket_replies_message_id_idx').on(t.emailMessageId),
  ],
);

/** Files uploaded to a ticket (web) or extracted from inbound mail. Stored under `STORAGE_PATH`. */
export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Null until the upload is linked to a reply. */
    replyId: uuid('reply_id').references(() => ticketReplies.id, { onDelete: 'set null' }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    /** Path relative to `STORAGE_PATH`. */
    path: varchar('path', { length: 500 }).notNull(),
    size: integer('size').notNull(),
    mimeType: varchar('mime_type', { length: 150 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_attachments_ticket_idx').on(t.ticketId),
    index('ticket_attachments_reply_idx').on(t.replyId),
  ],
);

/** Internal staff notes; never visible in the portal. */
export const ticketNotes = pgTable(
  'ticket_notes',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ticket_notes_ticket_idx').on(t.ticketId)],
);

/** Staff users who get `ticket.reply.staff` emails for a ticket in addition to the assignee. */
export const ticketWatchers = pgTable(
  'ticket_watchers',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ticket_watchers_unique_idx').on(t.ticketId, t.userId)],
);

/** Predefined staff replies. Body is a handlebars template with `{{client.firstName}}`-style placeholders. */
export const cannedResponses = pgTable('canned_responses', {
  id: id(),
  /** Null = available in every department. */
  departmentId: uuid('department_id').references(() => ticketDepartments.id, {
    onDelete: 'set null',
  }),
  title: varchar('title', { length: 150 }).notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const notificationLevelEnum = pgEnum('notification_level', ['info', 'warning', 'error']);

/** In-app notifications for staff (bell icon). `user_id` null = broadcast to every admin/staff user. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    level: notificationLevelEnum('level').notNull().default('info'),
    /** Dotted type, e.g. `ticket.opened`, `provisioning.failed`, `payment.failed`. */
    type: varchar('type', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    /** Relative admin URL, e.g. `/admin/tickets/<id>`. */
    link: varchar('link', { length: 500 }),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_read_idx').on(t.userId, t.readAt),
    index('notifications_created_idx').on(t.createdAt),
  ],
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  client: one(clients, { fields: [tickets.clientId], references: [clients.id] }),
  department: one(ticketDepartments, {
    fields: [tickets.departmentId],
    references: [ticketDepartments.id],
  }),
  assignee: one(users, { fields: [tickets.assignedToUserId], references: [users.id] }),
  replies: many(ticketReplies),
  notes: many(ticketNotes),
  attachments: many(ticketAttachments),
  watchers: many(ticketWatchers),
}));

export const ticketRepliesRelations = relations(ticketReplies, ({ one, many }) => ({
  ticket: one(tickets, { fields: [ticketReplies.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketReplies.authorUserId], references: [users.id] }),
  files: many(ticketAttachments),
}));

export const ticketAttachmentsRelations = relations(ticketAttachments, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketAttachments.ticketId], references: [tickets.id] }),
  reply: one(ticketReplies, {
    fields: [ticketAttachments.replyId],
    references: [ticketReplies.id],
  }),
}));

export const ticketNotesRelations = relations(ticketNotes, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketNotes.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketNotes.authorUserId], references: [users.id] }),
}));

export const ticketWatchersRelations = relations(ticketWatchers, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketWatchers.ticketId], references: [tickets.id] }),
  user: one(users, { fields: [ticketWatchers.userId], references: [users.id] }),
}));

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';
import { users } from './auth.js';
import { clients } from './clients.js';

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'answered',
  'customer_reply',
  'on_hold',
  'closed',
]);

export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'urgent']);

export const ticketDepartments = pgTable('ticket_departments', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  /** Outgoing address and IMAP ingest mailbox for this department. */
  email: varchar('email', { length: 255 }),
  description: text('description'),
  /** Only staff can see/select hidden departments (e.g. internal). */
  hidden: boolean('hidden').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type TicketAttachment = { name: string; path: string; size: number; mimeType: string };

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    /** Human-friendly ticket number shown in subjects, e.g. `#482913`. */
    number: varchar('number', { length: 20 }).notNull().unique(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => ticketDepartments.id, { onDelete: 'restrict' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    subject: varchar('subject', { length: 255 }).notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),
    priority: ticketPriorityEnum('priority').notNull().default('medium'),
    /** For tickets opened by email from unknown senders. */
    requesterEmail: varchar('requester_email', { length: 255 }),
    requesterName: varchar('requester_name', { length: 200 }),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_client_idx').on(t.clientId),
    index('tickets_department_status_idx').on(t.departmentId, t.status),
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
    /** Staff-only notes are never shown to the client. */
    internal: boolean('internal').notNull().default(false),
    body: text('body').notNull(),
    attachments: jsonb('attachments').$type<TicketAttachment[]>().notNull().default([]),
    /** Message-ID of the ingested email, for threading and de-duplication. */
    emailMessageId: varchar('email_message_id', { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_replies_ticket_idx').on(t.ticketId)],
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  client: one(clients, { fields: [tickets.clientId], references: [clients.id] }),
  department: one(ticketDepartments, {
    fields: [tickets.departmentId],
    references: [ticketDepartments.id],
  }),
  assignee: one(users, { fields: [tickets.assignedToUserId], references: [users.id] }),
  replies: many(ticketReplies),
}));

export const ticketRepliesRelations = relations(ticketReplies, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketReplies.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketReplies.authorUserId], references: [users.id] }),
}));

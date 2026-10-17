import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';
import { users } from './auth.js';

export const activityLog = pgTable(
  'activity_log',
  {
    id: id(),
    /** Null for system/worker actions. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `user` | `api_key` | `system`. */
    actorType: varchar('actor_type', { length: 20 }).notNull().default('user'),
    /** Dotted verb, e.g. `client.update`, `invoice.issue`. */
    action: varchar('action', { length: 100 }).notNull(),
    /** Table/entity name, e.g. `client`. */
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    /** `{ before, after }` or any structured change description. */
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    /** Set when the acting user was an admin logged in as a client ("login as"). */
    impersonatorUserId: uuid('impersonator_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_log_entity_idx').on(t.entityType, t.entityId),
    index('activity_log_action_idx').on(t.action),
    index('activity_log_actor_idx').on(t.actorUserId),
    index('activity_log_created_idx').on(t.createdAt),
  ],
);

export const emailStatusEnum = pgEnum('email_status', ['queued', 'sent', 'failed', 'bounced']);

/**
 * Admin overrides of the built-in handlebars templates in `@provisia/email`.
 * One row per (key, locale); missing rows fall back to the built-in template.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    /** Stable key used by code, e.g. `invoice.created` (see `EmailTemplateKey` in @provisia/shared). */
    key: varchar('key', { length: 100 }).notNull(),
    /** BCP 47 language tag: `en`, `nl`. */
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    name: varchar('name', { length: 150 }).notNull(),
    /** Handlebars source. */
    subject: text('subject').notNull(),
    /** Handlebars source; rendered inside the shared layout unless `use_layout` is false. */
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text'),
    useLayout: boolean('use_layout').notNull().default(true),
    /** Disabled templates are not sent at all (the send is logged as failed with `template_disabled`). */
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('email_templates_key_locale_idx').on(t.key, t.locale)],
);

export type EmailLogAttachment = { filename: string; size: number; contentType?: string };

/** Every outbound email, whether it was sent, failed or bounced. */
export const emailLog = pgTable(
  'email_log',
  {
    id: id(),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    toUserId: uuid('to_user_id').references(() => users.id, { onDelete: 'set null' }),
    cc: jsonb('cc').$type<string[]>().notNull().default([]),
    fromEmail: varchar('from_email', { length: 255 }),
    templateKey: varchar('template_key', { length: 100 }),
    locale: varchar('locale', { length: 10 }),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html'),
    bodyText: text('body_text'),
    attachments: jsonb('attachments').$type<EmailLogAttachment[]>().notNull().default([]),
    status: emailStatusEnum('status').notNull().default('queued'),
    error: text('error'),
    messageId: varchar('message_id', { length: 255 }),
    /** Delivery attempts made by the worker. */
    attempts: integer('attempts').notNull().default(0),
    /** Entity the mail is about, e.g. (`invoice`, id) or (`ticket`, id); used for resend and audit. */
    relatedType: varchar('related_type', { length: 50 }),
    relatedId: uuid('related_id'),
    /** Template data snapshot (no secrets) so the mail can be re-rendered/resent. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_log_to_idx').on(t.toEmail),
    index('email_log_created_idx').on(t.createdAt),
    index('email_log_related_idx').on(t.relatedType, t.relatedId),
    index('email_log_status_idx').on(t.status),
  ],
);

/** Key/value store. Keys and value shapes are typed by `settingsSchema` in @provisia/shared. */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const jobStatusEnum = pgEnum('job_status', ['running', 'completed', 'failed']);

export const jobsLog = pgTable(
  'jobs_log',
  {
    id: id(),
    queue: varchar('queue', { length: 50 }).notNull(),
    jobName: varchar('job_name', { length: 100 }).notNull(),
    /** BullMQ job id. */
    jobId: varchar('job_id', { length: 100 }),
    status: jobStatusEnum('status').notNull().default('running'),
    attempt: integer('attempt').notNull().default(1),
    payload: jsonb('payload').$type<unknown>(),
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_log_queue_idx').on(t.queue, t.jobName),
    index('jobs_log_started_idx').on(t.startedAt),
  ],
);

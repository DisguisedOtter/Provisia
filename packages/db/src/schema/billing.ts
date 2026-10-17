import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { clients } from './clients.js';
import { domains } from './domains.js';
import { services } from './services.js';

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'unpaid',
  'paid',
  'cancelled',
  'refunded',
  'collections',
]);

export const transactionTypeEnum = pgEnum('transaction_type', ['payment', 'refund', 'credit']);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** Sequential, gap-free per calendar year: `2026-000001`. Null while draft. */
    number: varchar('number', { length: 20 }),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    currency: currency(),
    subtotal: money('subtotal').notNull().default(0),
    taxTotal: money('tax_total').notNull().default(0),
    creditApplied: money('credit_applied').notNull().default(0),
    total: money('total').notNull().default(0),
    /** Percentage snapshot at issue time, e.g. 21.00. */
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    /** Snapshot of client billing details at issue time (legal requirement). */
    billingSnapshot: jsonb('billing_snapshot').$type<Record<string, unknown>>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    pdfPath: text('pdf_path'),
    notes: text('notes'),
    /** Last dunning step executed (e.g. `reminder_1`), used by the automation. */
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),
    /** Dunning markers (billing agent): set once, make each dunning step idempotent. */
    lateFeeAppliedAt: timestamp('late_fee_applied_at', { withTimezone: true }),
    dunningSuspendedAt: timestamp('dunning_suspended_at', { withTimezone: true }),
    dunningTerminatedAt: timestamp('dunning_terminated_at', { withTimezone: true }),
    /** When the invoice email was last handed to the email queue. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Per-rate tax breakdown at issue time: `[{ rate: "21.00", base, tax }]` (minor units). */
    taxSummary: jsonb('tax_summary').$type<Array<{ rate: string; base: number; tax: number }>>(),
    /** Invoice this one derives from (late-fee invoice -> original). */
    parentInvoiceId: uuid('parent_invoice_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_idx').on(t.number),
    index('invoices_client_idx').on(t.clientId),
    index('invoices_status_due_idx').on(t.status, t.dueDate),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitAmount: money('unit_amount').notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    /** quantity * unit_amount, excluding tax. */
    amount: money('amount').notNull(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('invoice_items_invoice_idx').on(t.invoiceId),
    // Recurring invoice generation is idempotent: one line per service (or domain) per period start.
    uniqueIndex('invoice_items_service_period_idx')
      .on(t.serviceId, t.periodStart)
      .where(sql`service_id is not null and period_start is not null`),
    uniqueIndex('invoice_items_domain_period_idx')
      .on(t.domainId, t.periodStart)
      .where(sql`domain_id is not null and period_start is not null`),
  ],
);

/**
 * Gap-free document numbering, one row per (kind, year). Issuance does `SELECT ... FOR UPDATE` on the row
 * inside the same transaction that writes the invoice number, so concurrent issues serialize here.
 */
export const invoiceCounters = pgTable(
  'invoice_counters',
  {
    /** `invoice` | `credit_note`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    /** Gateway module id, or `manual` / `credit`. */
    gateway: varchar('gateway', { length: 50 }).notNull(),
    gatewayTxnId: varchar('gateway_txn_id', { length: 255 }),
    type: transactionTypeEnum('type').notNull().default('payment'),
    amount: money('amount').notNull(),
    fee: money('fee').notNull().default(0),
    currency: currency(),
    description: text('description'),
    /** Raw gateway payload for audit/debugging. */
    gatewayData: jsonb('gateway_data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    // Webhook idempotency: the same gateway event can never be booked twice.
    uniqueIndex('transactions_gateway_txn_idx').on(t.gateway, t.gatewayTxnId),
    index('transactions_invoice_idx').on(t.invoiceId),
    index('transactions_client_idx').on(t.clientId),
  ],
);

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    /** Sequential per year like invoices: `CN-2026-000001`. */
    number: varchar('number', { length: 20 }).notNull(),
    issueDate: date('issue_date').notNull(),
    currency: currency(),
    subtotal: money('subtotal').notNull().default(0),
    taxTotal: money('tax_total').notNull().default(0),
    total: money('total').notNull().default(0),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    taxSummary: jsonb('tax_summary').$type<Array<{ rate: string; base: number; tax: number }>>(),
    billingSnapshot: jsonb('billing_snapshot').$type<Record<string, unknown>>(),
    reason: text('reason'),
    pdfPath: text('pdf_path'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_notes_number_idx').on(t.number),
    index('credit_notes_client_idx').on(t.clientId),
  ],
);

export const creditNoteItems = pgTable(
  'credit_note_items',
  {
    id: id(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitAmount: money('unit_amount').notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    amount: money('amount').notNull(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('credit_note_items_note_idx').on(t.creditNoteId)],
);

export const taxRules = pgTable(
  'tax_rules',
  {
    id: id(),
    /** ISO 3166-1 alpha-2. `*` is not used; countries without a rule get 0% (export). */
    country: char('country', { length: 2 }).notNull(),
    eu: boolean('eu').notNull().default(false),
    /** Standard VAT rate percentage, e.g. 21.00. */
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
    /** B2B with validated VAT number -> 0% reverse charge (intra-EU, never for the home country). */
    b2bReverseCharge: boolean('b2b_reverse_charge').notNull().default(false),
    validFrom: date('valid_from').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('tax_rules_country_idx').on(t.country, t.validFrom)],
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  items: many(invoiceItems),
  transactions: many(transactions),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  service: one(services, { fields: [invoiceItems.serviceId], references: [services.id] }),
  domain: one(domains, { fields: [invoiceItems.domainId], references: [domains.id] }),
}));

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  client: one(clients, { fields: [creditNotes.clientId], references: [clients.id] }),
  invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
  items: many(creditNoteItems),
}));

export const creditNoteItemsRelations = relations(creditNoteItems, ({ one }) => ({
  creditNote: one(creditNotes, {
    fields: [creditNoteItems.creditNoteId],
    references: [creditNotes.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  invoice: one(invoices, { fields: [transactions.invoiceId], references: [invoices.id] }),
  client: one(clients, { fields: [transactions.clientId], references: [clients.id] }),
}));

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
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
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { users } from './auth.js';
import { clients } from './clients.js';

/**
 * Lifecycle (see apps/api/src/modules/domains/README.md):
 * pending -> pending_registration -> active -> expired -> redemption -> cancelled
 * pending -> pending_transfer -> active | cancelled ; active -> transferred_away
 */
export const domainStatusEnum = pgEnum('domain_status', [
  'pending',
  'pending_registration',
  'pending_transfer',
  'active',
  'expired',
  'redemption',
  'cancelled',
  'transferred_away',
]);

export type DomainContact = {
  firstName: string;
  lastName: string;
  organization?: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  postalCode: string;
  state?: string;
  country: string;
};

export type DomainContacts = {
  registrant: DomainContact;
  admin?: DomainContact;
  tech?: DomainContact;
  billing?: DomainContact;
};

/** One row per registrar module that is configured; config is encrypted (holds the API key). */
export const registrarAccounts = pgTable('registrar_accounts', {
  id: id(),
  /** Registrar module id from the ModuleRegistry (e.g. `skrime`). */
  module: varchar('module', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  /** AES-256-GCM encrypted JSON validated against the module's configSchema. */
  configEncrypted: text('config_encrypted').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  /** Last successful pricing import. */
  pricingImportedAt: timestamp('pricing_imported_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Sellable TLD catalog. Prices live in `tld_prices` (one row per period length in years). */
export const tlds = pgTable(
  'tlds',
  {
    id: id(),
    /** Without leading dot, lowercase: `nl`, `co.uk`. */
    tld: varchar('tld', { length: 63 }).notNull(),
    /** Registrar module that handles this TLD; null = manual. */
    registrarModule: varchar('registrar_module', { length: 50 }),
    enabled: boolean('enabled').notNull().default(true),
    /** Shown first in the availability search / suggestions. */
    featured: boolean('featured').notNull().default(false),
    currency: currency(),
    minYears: integer('min_years').notNull().default(1),
    maxYears: integer('max_years').notNull().default(10),
    eppRequired: boolean('epp_required').notNull().default(true),
    idProtectionSupported: boolean('id_protection_supported').notNull().default(false),
    dnsManagementSupported: boolean('dns_management_supported').notNull().default(false),
    /** Days after expiry during which a plain renew still works (auto-renew grace). */
    gracePeriodDays: integer('grace_period_days').notNull().default(0),
    /** Days in redemption after the grace period; restore costs `redemptionFee`. */
    redemptionPeriodDays: integer('redemption_period_days').notNull().default(30),
    redemptionFee: money('redemption_fee').notNull().default(0),
    /** Registry specific extra fields required at registration (e.g. .nl legal form). */
    additionalFields: jsonb('additional_fields')
      .$type<Array<{ name: string; label: string; required: boolean; options?: string[] }>>()
      .notNull()
      .default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tlds_tld_idx').on(t.tld), index('tlds_registrar_idx').on(t.registrarModule)],
);

export const tldPrices = pgTable(
  'tld_prices',
  {
    id: id(),
    tldId: uuid('tld_id')
      .notNull()
      .references(() => tlds.id, { onDelete: 'cascade' }),
    /** Period length in years this row prices. */
    years: integer('years').notNull().default(1),
    currency: currency(),
    /** Sell prices for the whole period (minor units). */
    register: money('register').notNull().default(0),
    renew: money('renew').notNull().default(0),
    transfer: money('transfer').notNull().default(0),
    /** Registrar cost for the whole period, filled by the pricing import; null = unknown. */
    costRegister: money('cost_register'),
    costRenew: money('cost_renew'),
    costTransfer: money('cost_transfer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tld_prices_unique_idx').on(t.tldId, t.years, t.currency)],
);

/** Reusable WHOIS contact handles per client; a domain references up to four of them. */
export const domainContacts = pgTable(
  'domain_contacts',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }).notNull().default('Default'),
    isDefault: boolean('is_default').notNull().default(false),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    organization: varchar('organization', { length: 200 }),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 40 }).notNull(),
    address1: varchar('address1', { length: 200 }).notNull(),
    address2: varchar('address2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 20 }).notNull(),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 2 }).notNull(),
    /** Registrar-side handle ids keyed by module id, e.g. `{ skrime: "C123" }`. */
    registrarHandles: jsonb('registrar_handles')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('domain_contacts_client_idx').on(t.clientId)],
);

export const domains = pgTable(
  'domains',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** Full domain name, lowercase, e.g. `example.nl`. */
    name: varchar('name', { length: 255 }).notNull(),
    /** TLD without leading dot, e.g. `nl`, `co.uk`. */
    tld: varchar('tld', { length: 63 }).notNull(),
    /** Registrar module id from the ModuleRegistry (e.g. `skrime`). */
    registrarModule: varchar('registrar_module', { length: 50 }),
    status: domainStatusEnum('status').notNull().default('pending'),
    /** Raw status string as last reported by the registrar (debugging aid). */
    registrarStatus: varchar('registrar_status', { length: 50 }),
    registrationDate: date('registration_date'),
    expiryDate: date('expiry_date'),
    nextDueDate: date('next_due_date'),
    registrationPeriod: integer('registration_period').notNull().default(1),
    recurringAmount: money('recurring_amount').notNull().default(0),
    currency: currency(),
    nameservers: jsonb('nameservers').$type<string[]>().notNull().default([]),
    autoRenew: boolean('auto_renew').notNull().default(true),
    locked: boolean('locked').notNull().default(true),
    idProtection: boolean('id_protection').notNull().default(false),
    /** AES-256-GCM encrypted. */
    eppCodeEncrypted: text('epp_code_encrypted'),
    /** Snapshot of the contacts as last sent to the registrar. */
    contacts: jsonb('contacts').$type<DomainContacts | null>(),
    registrantContactId: uuid('registrant_contact_id').references(() => domainContacts.id, {
      onDelete: 'set null',
    }),
    adminContactId: uuid('admin_contact_id').references(() => domainContacts.id, {
      onDelete: 'set null',
    }),
    techContactId: uuid('tech_contact_id').references(() => domainContacts.id, {
      onDelete: 'set null',
    }),
    billingContactId: uuid('billing_contact_id').references(() => domainContacts.id, {
      onDelete: 'set null',
    }),
    /** Opaque registrar state (remote ids etc.). */
    moduleData: jsonb('module_data').$type<Record<string, unknown>>().notNull().default({}),
    /** Last registrar/worker error for this domain; cleared on the next successful job. */
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Expiry notices already sent for the current expiry date, e.g. `[60, 30]`. */
    expiryNoticesSent: jsonb('expiry_notices_sent').$type<number[]>().notNull().default([]),
    /** Set when an auto-renew invoice item was created for the current expiry. */
    autoRenewInvoicedAt: timestamp('auto_renew_invoiced_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('domains_name_idx').on(t.name),
    index('domains_client_idx').on(t.clientId),
    index('domains_expiry_idx').on(t.expiryDate),
    index('domains_status_idx').on(t.status),
  ],
);

/** Every registrar interaction performed by the worker, successful or not. */
export const domainSyncLog = pgTable(
  'domain_sync_log',
  {
    id: id(),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
    /** Worker job name: `register`, `transfer`, `renew`, `sync`, `expiryNotices`, `autoRenew`, `importPricing`. */
    job: varchar('job', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().$type<'ok' | 'failed' | 'skipped'>(),
    /** Status transition performed, e.g. `pending_registration -> active`. */
    transition: varchar('transition', { length: 80 }),
    message: text('message'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('domain_sync_log_domain_idx').on(t.domainId, t.createdAt),
    index('domain_sync_log_created_idx').on(t.createdAt),
  ],
);

/** Admin notifications raised by the domain worker (failed registration, registrar mismatch, ...). */
export const domainAlerts = pgTable(
  'domain_alerts',
  {
    id: id(),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
    severity: varchar('severity', { length: 10 }).notNull().$type<'info' | 'warning' | 'error'>(),
    /** Stable key for grouping, e.g. `register_failed`, `registrar_not_found`. */
    kind: varchar('kind', { length: 50 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('domain_alerts_open_idx').on(t.acknowledgedAt, t.createdAt),
    index('domain_alerts_domain_idx').on(t.domainId),
  ],
);

export const tldsRelations = relations(tlds, ({ many }) => ({ prices: many(tldPrices) }));
export const tldPricesRelations = relations(tldPrices, ({ one }) => ({
  tld: one(tlds, { fields: [tldPrices.tldId], references: [tlds.id] }),
}));

export const domainContactsRelations = relations(domainContacts, ({ one }) => ({
  client: one(clients, { fields: [domainContacts.clientId], references: [clients.id] }),
}));

export const domainsRelations = relations(domains, ({ one, many }) => ({
  client: one(clients, { fields: [domains.clientId], references: [clients.id] }),
  registrantContact: one(domainContacts, {
    fields: [domains.registrantContactId],
    references: [domainContacts.id],
  }),
  syncLog: many(domainSyncLog),
  alerts: many(domainAlerts),
}));

export const domainSyncLogRelations = relations(domainSyncLog, ({ one }) => ({
  domain: one(domains, { fields: [domainSyncLog.domainId], references: [domains.id] }),
}));

export const domainAlertsRelations = relations(domainAlerts, ({ one }) => ({
  domain: one(domains, { fields: [domainAlerts.domainId], references: [domains.id] }),
}));

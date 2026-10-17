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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { clients } from './clients.js';

export const domainStatusEnum = pgEnum('domain_status', [
  'pending',
  'pending_transfer',
  'active',
  'expired',
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
    contacts: jsonb('contacts').$type<DomainContacts | null>(),
    /** Opaque registrar state (remote ids etc.). */
    moduleData: jsonb('module_data').$type<Record<string, unknown>>().notNull().default({}),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('domains_name_idx').on(t.name),
    index('domains_client_idx').on(t.clientId),
    index('domains_expiry_idx').on(t.expiryDate),
  ],
);

export const domainsRelations = relations(domains, ({ one }) => ({
  client: one(clients, { fields: [domains.clientId], references: [clients.id] }),
}));

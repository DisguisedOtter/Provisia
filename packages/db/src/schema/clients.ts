import { relations } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, money, updatedAt } from './_common.js';
import { users } from './auth.js';

export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive', 'closed']);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    /** Primary login for this client. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    companyName: varchar('company_name', { length: 200 }),
    vatNumber: varchar('vat_number', { length: 32 }),
    vatValidated: boolean('vat_validated').notNull().default(false),
    vatValidatedAt: timestamp('vat_validated_at', { withTimezone: true }),
    address1: varchar('address1', { length: 200 }).notNull().default(''),
    address2: varchar('address2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull().default(''),
    postalCode: varchar('postal_code', { length: 20 }).notNull().default(''),
    state: varchar('state', { length: 100 }),
    /** ISO 3166-1 alpha-2, uppercase. */
    country: char('country', { length: 2 }).notNull().default('NL'),
    phone: varchar('phone', { length: 40 }),
    /** BCP 47 language tag used for emails and the portal. */
    language: varchar('language', { length: 10 }).notNull().default('en'),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    creditBalance: money('credit_balance').notNull().default(0),
    status: clientStatusEnum('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('clients_user_idx').on(t.userId), index('clients_country_idx').on(t.country)],
);

export type ClientContactPermissions = {
  services: boolean;
  domains: boolean;
  invoices: boolean;
  tickets: boolean;
  profile: boolean;
};

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Set when the contact can log in as a sub-user. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    permissions: jsonb('permissions')
      .$type<ClientContactPermissions>()
      .notNull()
      .default({ services: false, domains: false, invoices: false, tickets: true, profile: false }),
    receivesInvoiceEmails: boolean('receives_invoice_emails').notNull().default(false),
    receivesSupportEmails: boolean('receives_support_emails').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('client_contacts_client_idx').on(t.clientId)],
);

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, { fields: [clients.userId], references: [users.id] }),
  contacts: many(clientContacts),
}));

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  client: one(clients, { fields: [clientContacts.clientId], references: [clients.id] }),
  user: one(users, { fields: [clientContacts.userId], references: [users.id] }),
}));

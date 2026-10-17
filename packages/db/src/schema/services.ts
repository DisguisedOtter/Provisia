import { relations } from 'drizzle-orm';
import { date, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { billingCycleEnum, products } from './catalog.js';
import { clients } from './clients.js';
import { servers } from './servers.js';

export const serviceStatusEnum = pgEnum('service_status', [
  'pending',
  'active',
  'suspended',
  'terminated',
  'cancelled',
]);

export const services = pgTable(
  'services',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    serverId: uuid('server_id').references(() => servers.id, { onDelete: 'set null' }),
    status: serviceStatusEnum('status').notNull().default('pending'),
    billingCycle: billingCycleEnum('billing_cycle').notNull(),
    recurringAmount: money('recurring_amount').notNull().default(0),
    currency: currency(),
    registrationDate: date('registration_date').notNull(),
    nextDueDate: date('next_due_date'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    cancellationRequestedAt: timestamp('cancellation_requested_at', { withTimezone: true }),
    domain: varchar('domain', { length: 255 }),
    username: varchar('username', { length: 100 }),
    /** AES-256-GCM encrypted panel password, if the module needs to keep it. */
    passwordEncrypted: text('password_encrypted'),
    /** Opaque state returned by the provisioner (account id, VM id, ...). */
    moduleData: jsonb('module_data').$type<Record<string, unknown>>().notNull().default({}),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('services_client_idx').on(t.clientId),
    index('services_product_idx').on(t.productId),
    index('services_server_idx').on(t.serverId),
    index('services_next_due_idx').on(t.nextDueDate),
  ],
);

export const servicesRelations = relations(services, ({ one }) => ({
  client: one(clients, { fields: [services.clientId], references: [clients.id] }),
  product: one(products, { fields: [services.productId], references: [products.id] }),
  server: one(servers, { fields: [services.serverId], references: [servers.id] }),
}));

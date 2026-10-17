import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { invoices } from './billing.js';
import { billingCycleEnum, products } from './catalog.js';
import { clients } from './clients.js';
import { domains } from './domains.js';
import { services } from './services.js';

export const orderStatusEnum = pgEnum('order_status', ['pending', 'active', 'fraud', 'cancelled']);
export const orderItemTypeEnum = pgEnum('order_item_type', [
  'product',
  'domain_register',
  'domain_transfer',
]);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** Human-friendly order number, e.g. `ORD-2026-000001`. */
    number: varchar('number', { length: 20 }).notNull().unique(),
    status: orderStatusEnum('status').notNull().default('pending'),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    currency: currency(),
    subtotal: money('subtotal').notNull().default(0),
    taxTotal: money('tax_total').notNull().default(0),
    total: money('total').notNull().default(0),
    promoCode: varchar('promo_code', { length: 50 }),
    ip: varchar('ip', { length: 45 }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('orders_client_idx').on(t.clientId), index('orders_status_idx').on(t.status)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: orderItemTypeEnum('type').notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** For domain items and for products that require a domain. */
    domainName: varchar('domain_name', { length: 255 }),
    billingCycle: billingCycleEnum('billing_cycle').notNull(),
    /** Years for domain items; 1 for products. */
    quantity: integer('quantity').notNull().default(1),
    setupFee: money('setup_fee').notNull().default(0),
    amount: money('amount').notNull().default(0),
    /** Configurable options chosen in the cart. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Set once the item has been activated. */
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  client: one(clients, { fields: [orders.clientId], references: [clients.id] }),
  invoice: one(invoices, { fields: [orders.invoiceId], references: [invoices.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

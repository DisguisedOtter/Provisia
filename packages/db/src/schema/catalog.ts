import { relations } from 'drizzle-orm';
import {
  boolean,
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

export const productTypeEnum = pgEnum('product_type', ['hosting', 'vps', 'domain', 'other']);

export const billingCycleEnum = pgEnum('billing_cycle', [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
  'onetime',
]);

export const productGroups = pgTable('product_groups', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const products = pgTable(
  'products',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => productGroups.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 150 }).notNull().unique(),
    description: text('description'),
    type: productTypeEnum('type').notNull().default('hosting'),
    /** Provisioner module id from the ModuleRegistry (e.g. `cpanel`), null = no automation. */
    module: varchar('module', { length: 50 }),
    /** Validated against the module's configSchema. Module secrets must be encrypted. */
    moduleConfig: jsonb('module_config').$type<Record<string, unknown>>().notNull().default({}),
    /** Server group name used to pick a server at provisioning time. */
    serverGroup: varchar('server_group', { length: 100 }),
    taxable: boolean('taxable').notNull().default(true),
    requiresDomain: boolean('requires_domain').notNull().default(false),
    stockControl: boolean('stock_control').notNull().default(false),
    stock: integer('stock').notNull().default(0),
    hidden: boolean('hidden').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_group_idx').on(t.groupId)],
);

export const productPrices = pgTable(
  'product_prices',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    billingCycle: billingCycleEnum('billing_cycle').notNull(),
    currency: currency(),
    setupFee: money('setup_fee').notNull().default(0),
    recurring: money('recurring').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('product_prices_unique_idx').on(t.productId, t.billingCycle, t.currency)],
);

export const productGroupsRelations = relations(productGroups, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  group: one(productGroups, { fields: [products.groupId], references: [productGroups.id] }),
  prices: many(productPrices),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
}));

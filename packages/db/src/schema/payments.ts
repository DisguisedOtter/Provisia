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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, money, updatedAt } from './_common.js';
import { invoices } from './billing.js';
import { clients } from './clients.js';

/** One row per installed gateway module that an admin configured. `config_encrypted` holds the zod-validated config. */
export const paymentGateways = pgTable(
  'payment_gateways',
  {
    id: id(),
    /** Module id from the registry (`stripe`, `paypal`, `mollie`, `btcpay`). */
    gatewayId: varchar('gateway_id', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 100 }),
    enabled: boolean('enabled').notNull().default(false),
    /** AES-256-GCM encrypted JSON of the module config (module-sdk `encryptJson`). */
    configEncrypted: text('config_encrypted'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('payment_gateways_gateway_idx').on(t.gatewayId)],
);

export const paymentMethodStatusEnum = pgEnum('payment_method_status', [
  'pending',
  'active',
  'revoked',
]);

/** Saved payment methods (Stripe payment methods, Mollie mandates, ...) for off-session charging. */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    gateway: varchar('gateway', { length: 50 }).notNull(),
    /** `card`, `sepa_debit`, `ideal`, `paypal`, ... in the gateway's vocabulary. */
    type: varchar('type', { length: 50 }).notNull(),
    gatewayCustomerId: varchar('gateway_customer_id', { length: 255 }),
    /** Stripe `pm_...`, Mollie `mdt_...`. */
    gatewayMethodId: varchar('gateway_method_id', { length: 255 }).notNull(),
    label: varchar('label', { length: 200 }).notNull().default(''),
    /** `YYYY-MM` for cards. */
    expiresAt: varchar('expires_at', { length: 10 }),
    isDefault: boolean('is_default').notNull().default(false),
    status: paymentMethodStatusEnum('status').notNull().default('active'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payment_methods_gateway_method_idx').on(t.gateway, t.gatewayMethodId),
    index('payment_methods_client_idx').on(t.clientId),
  ],
);

/** Per-client auto-pay preference: charge the chosen saved method when an invoice is due. */
export const clientPaymentPreferences = pgTable('client_payment_preferences', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  autoPay: boolean('auto_pay').notNull().default(false),
  paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, {
    onDelete: 'set null',
  }),
  updatedAt: updatedAt(),
});

export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'pending',
  'succeeded',
  'failed',
  'expired',
]);
export const paymentIntentSourceEnum = pgEnum('payment_intent_source', ['checkout', 'autopay']);

/** Every payment we started at a gateway. Pending rows are reconciled by the worker. */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    gateway: varchar('gateway', { length: 50 }).notNull(),
    /** Id returned by `createPayment` / `chargeSavedMethod` (Stripe pi/cs, PayPal order, Mollie tr, BTCPay invoice). */
    gatewayTxnId: varchar('gateway_txn_id', { length: 255 }).notNull(),
    amount: money('amount').notNull(),
    currency: currency(),
    status: paymentIntentStatusEnum('status').notNull().default('pending'),
    source: paymentIntentSourceEnum('source').notNull().default('checkout'),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payment_intents_gateway_txn_idx').on(t.gateway, t.gatewayTxnId),
    index('payment_intents_invoice_idx').on(t.invoiceId),
    index('payment_intents_status_idx').on(t.status, t.createdAt),
  ],
);

export const webhookEventStatusEnum = pgEnum('payment_webhook_event_status', [
  'received',
  'processed',
  'ignored',
  'failed',
]);

/** Inbound webhook log. `(gateway, event_id)` is unique so a redelivered event is never processed twice. */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: id(),
    gateway: varchar('gateway', { length: 50 }).notNull(),
    /** Gateway event id (Stripe `evt_`, PayPal event id, BTCPay delivery id) or `<txn>:<kind>` for Mollie. */
    eventId: varchar('event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 100 }),
    status: webhookEventStatusEnum('status').notNull().default('received'),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    txnId: varchar('txn_id', { length: 255 }),
    /** The `WebhookResult` as returned by the gateway (never the raw secret-bearing request). */
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payment_webhook_events_gateway_event_idx').on(t.gateway, t.eventId),
    index('payment_webhook_events_invoice_idx').on(t.invoiceId),
  ],
);

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  client: one(clients, { fields: [paymentMethods.clientId], references: [clients.id] }),
}));

export const paymentIntentsRelations = relations(paymentIntents, ({ one }) => ({
  invoice: one(invoices, { fields: [paymentIntents.invoiceId], references: [invoices.id] }),
  client: one(clients, { fields: [paymentIntents.clientId], references: [clients.id] }),
  paymentMethod: one(paymentMethods, {
    fields: [paymentIntents.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

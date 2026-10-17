import { z } from 'zod';
import { currencyCodeSchema, minorUnitsSchema, timestampSchema, uuidSchema } from './common.js';

/** Gateway module ids shipped with Provisia. Custom gateways use any `[a-z0-9_-]+` id. */
export const gatewayIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const gatewayCapabilitiesSchema = z.object({
  refunds: z.boolean(),
  savedMethods: z.boolean(),
  recurring: z.boolean(),
});
export type GatewayCapabilities = z.infer<typeof gatewayCapabilitiesSchema>;

/** Admin view of a gateway: module metadata + stored configuration (secrets masked). */
export const paymentGatewaySchema = z.object({
  id: gatewayIdSchema,
  name: z.string(),
  version: z.string(),
  capabilities: gatewayCapabilitiesSchema,
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  configured: z.boolean(),
  /** Config values with secret-looking keys replaced by `MASKED_SECRET`. */
  config: z.record(z.string(), z.unknown()),
  /** JSON Schema of the module's config, for building the admin form. */
  configSchema: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int(),
  updatedAt: timestampSchema.nullable(),
});
export type PaymentGatewayInfo = z.infer<typeof paymentGatewaySchema>;

/** Placeholder returned for secret config values; sending it back keeps the stored value. */
export const MASKED_SECRET = '********';

export const configureGatewaySchema = z.object({
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
  displayName: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type ConfigureGateway = z.infer<typeof configureGatewaySchema>;

/** What the portal shows when picking how to pay. */
export const portalGatewaySchema = z.object({
  id: gatewayIdSchema,
  name: z.string(),
  capabilities: gatewayCapabilitiesSchema,
});
export type PortalGateway = z.infer<typeof portalGatewaySchema>;

export const testCredentialsResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type TestCredentialsResult = z.infer<typeof testCredentialsResultSchema>;

export const payInvoiceSchema = z.object({ gateway: gatewayIdSchema });
export type PayInvoice = z.infer<typeof payInvoiceSchema>;

export const paymentIntentStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'expired']);
export type PaymentIntentStatus = z.infer<typeof paymentIntentStatusSchema>;

/** Response of `POST /portal/invoices/:id/pay`. Either redirect the browser or confirm client-side. */
export const paymentStartSchema = z.object({
  gateway: gatewayIdSchema,
  txnId: z.string(),
  redirectUrl: z.string().optional(),
  clientSecret: z.string().optional(),
  /** Gateway-specific public data the client needs (e.g. Stripe publishable key). */
  publicConfig: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentStart = z.infer<typeof paymentStartSchema>;

export const paymentMethodStatusSchema = z.enum(['pending', 'active', 'revoked']);
export type PaymentMethodStatus = z.infer<typeof paymentMethodStatusSchema>;

export const paymentMethodSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  gateway: gatewayIdSchema,
  /** `card`, `sepa_debit`, `ideal`, `paypal`, ... (gateway vocabulary). */
  type: z.string(),
  gatewayCustomerId: z.string().nullable(),
  gatewayMethodId: z.string(),
  label: z.string(),
  expiresAt: z.string().nullable(),
  isDefault: z.boolean(),
  status: paymentMethodStatusSchema,
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const addPaymentMethodSchema = z.object({ gateway: gatewayIdSchema });
export type AddPaymentMethod = z.infer<typeof addPaymentMethodSchema>;

/** Response of `POST /portal/payments/methods`: redirect to the gateway or confirm client-side. */
export const setupStartSchema = z.object({
  gateway: gatewayIdSchema,
  setupId: z.string(),
  redirectUrl: z.string().optional(),
  clientSecret: z.string().optional(),
  publicConfig: z.record(z.string(), z.unknown()).optional(),
});
export type SetupStart = z.infer<typeof setupStartSchema>;

export const autoPaySettingsSchema = z.object({
  enabled: z.boolean(),
  paymentMethodId: uuidSchema.nullable(),
});
export type AutoPaySettings = z.infer<typeof autoPaySettingsSchema>;

export const refundRequestSchema = z.object({
  /** Minor units; defaults to the full remaining refundable amount. */
  amount: minorUnitsSchema.positive().optional(),
  reason: z.string().max(500).optional(),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const refundResponseSchema = z.object({
  refundTxnId: z.string(),
  amount: minorUnitsSchema,
  currency: currencyCodeSchema,
  status: z.enum(['completed', 'pending']),
});
export type RefundResponse = z.infer<typeof refundResponseSchema>;

export const webhookEventStatusSchema = z.enum(['received', 'processed', 'ignored', 'failed']);
export type WebhookEventStatus = z.infer<typeof webhookEventStatusSchema>;

export const paymentWebhookEventSchema = z.object({
  id: uuidSchema,
  gateway: gatewayIdSchema,
  eventId: z.string(),
  eventType: z.string().nullable(),
  status: webhookEventStatusSchema,
  invoiceId: uuidSchema.nullable(),
  txnId: z.string().nullable(),
  error: z.string().nullable(),
  receivedAt: timestampSchema,
  processedAt: timestampSchema.nullable(),
});
export type PaymentWebhookEvent = z.infer<typeof paymentWebhookEventSchema>;

export const paymentIntentSchema = z.object({
  id: uuidSchema,
  invoiceId: uuidSchema,
  clientId: uuidSchema,
  gateway: gatewayIdSchema,
  gatewayTxnId: z.string(),
  amount: minorUnitsSchema,
  currency: currencyCodeSchema,
  status: paymentIntentStatusSchema,
  /** `checkout` (customer initiated) or `autopay` (worker). */
  source: z.enum(['checkout', 'autopay']),
  error: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

import { z } from 'zod';
import {
  billingCycleSchema,
  countryCodeSchema,
  currencyCodeSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { domainNameSchema } from './domains.js';
import { paginationQuerySchema } from './pagination.js';

export const orderStatusSchema = z.enum(['pending', 'active', 'fraud', 'cancelled']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemTypeSchema = z.enum(['product', 'domain_register', 'domain_transfer']);
export type OrderItemType = z.infer<typeof orderItemTypeSchema>;

export const orderItemSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  type: orderItemTypeSchema,
  productId: uuidSchema.nullable(),
  domainName: z.string().nullable(),
  billingCycle: billingCycleSchema,
  quantity: z.number().int(),
  setupFee: minorUnitsSchema,
  amount: minorUnitsSchema,
  config: z.record(z.string(), z.unknown()),
  serviceId: uuidSchema.nullable(),
  domainId: uuidSchema.nullable(),
  createdAt: timestampSchema,
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  number: z.string(),
  status: orderStatusSchema,
  invoiceId: uuidSchema.nullable(),
  currency: currencyCodeSchema,
  subtotal: minorUnitsSchema,
  taxTotal: minorUnitsSchema,
  total: minorUnitsSchema,
  promoCode: z.string().nullable(),
  ip: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Order = z.infer<typeof orderSchema>;

export const orderWithItemsSchema = orderSchema.extend({ items: z.array(orderItemSchema) });
export type OrderWithItems = z.infer<typeof orderWithItemsSchema>;

export const cartItemSchema = z.object({
  type: orderItemTypeSchema,
  productId: uuidSchema.optional(),
  domainName: domainNameSchema.optional(),
  billingCycle: billingCycleSchema,
  quantity: z.number().int().min(1).max(10).default(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const createOrderSchema = z.object({
  /** Admin only; portal derives it from the session. */
  clientId: uuidSchema.optional(),
  items: z.array(cartItemSchema).min(1),
  promoCode: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  clientId: uuidSchema.optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/** Price preview for a cart before the order is placed (portal checkout + admin order form). */
export const cartQuoteLineSchema = z.object({
  description: z.string(),
  billingCycle: billingCycleSchema,
  quantity: z.number().int(),
  setupFee: minorUnitsSchema,
  amount: minorUnitsSchema,
  taxRate: z.string(),
});
export const cartQuoteSchema = z.object({
  currency: currencyCodeSchema,
  lines: z.array(cartQuoteLineSchema),
  subtotal: minorUnitsSchema,
  taxTotal: minorUnitsSchema,
  total: minorUnitsSchema,
  reverseCharge: z.boolean(),
});
export type CartQuote = z.infer<typeof cartQuoteSchema>;

export const orderQuoteRequestSchema = createOrderSchema.pick({ clientId: true, items: true });
export type OrderQuoteRequest = z.infer<typeof orderQuoteRequestSchema>;

/** Storefront quote for a visitor without an account: tax follows the given country / VAT number. */
export const guestQuoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  country: countryCodeSchema,
  vatNumber: z.string().max(32).optional(),
  promoCode: z.string().max(50).optional(),
});
export type GuestQuoteRequest = z.infer<typeof guestQuoteRequestSchema>;

export const guestQuoteSchema = cartQuoteSchema.extend({
  /** `null` when no code was given; promo codes are not implemented yet, so a given code is `false`. */
  promoValid: z.boolean().nullable(),
});
export type GuestQuote = z.infer<typeof guestQuoteSchema>;

export const orderCancelSchema = z.object({ reason: z.string().max(500).optional() });

/** Accept result: the activated order plus the invoice it produced. */
export const orderAcceptResultSchema = orderWithItemsSchema.extend({
  invoice: z
    .object({
      id: uuidSchema,
      number: z.string().nullable(),
      status: z.string(),
      total: minorUnitsSchema,
    })
    .nullable(),
});
export type OrderAcceptResult = z.infer<typeof orderAcceptResultSchema>;

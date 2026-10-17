import { z } from 'zod';
import {
  billingCycleSchema,
  currencyCodeSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { domainNameSchema } from './domains.js';

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

import { z } from 'zod';
import {
  billingCycleSchema,
  currencyCodeSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const serviceStatusSchema = z.enum([
  'pending',
  'active',
  'suspended',
  'terminated',
  'cancelled',
]);
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/** Password is never included; `moduleData` is admin-only. */
export const serviceSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  productId: uuidSchema,
  serverId: uuidSchema.nullable(),
  status: serviceStatusSchema,
  billingCycle: billingCycleSchema,
  recurringAmount: minorUnitsSchema,
  currency: currencyCodeSchema,
  registrationDate: isoDateSchema,
  nextDueDate: isoDateSchema.nullable(),
  suspendedAt: timestampSchema.nullable(),
  suspendReason: z.string().nullable(),
  terminatedAt: timestampSchema.nullable(),
  cancellationRequestedAt: timestampSchema.nullable(),
  domain: z.string().nullable(),
  username: z.string().nullable(),
  moduleData: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Service = z.infer<typeof serviceSchema>;

export const createServiceSchema = z.object({
  clientId: uuidSchema,
  productId: uuidSchema,
  serverId: uuidSchema.nullable().optional(),
  billingCycle: billingCycleSchema,
  recurringAmount: minorUnitsSchema,
  currency: currencyCodeSchema.default('EUR'),
  registrationDate: isoDateSchema.optional(),
  nextDueDate: isoDateSchema.nullable().optional(),
  domain: z.string().max(255).nullable().optional(),
  username: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateService = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema
  .omit({ clientId: true, productId: true })
  .partial()
  .extend({ status: serviceStatusSchema.optional() });
export type UpdateService = z.infer<typeof updateServiceSchema>;

export const serviceListQuerySchema = paginationQuerySchema.extend({
  status: serviceStatusSchema.optional(),
  clientId: uuidSchema.optional(),
  productId: uuidSchema.optional(),
});
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;

/** Admin: move a service to another product/cycle; billing prorates to the next due date. */
export const changeServicePackageSchema = z.object({
  productId: uuidSchema,
  billingCycle: billingCycleSchema.optional(),
  /** Create (and issue) the proration invoice / credit immediately. Default true. */
  invoice: z.boolean().default(true),
});
export type ChangeServicePackage = z.infer<typeof changeServicePackageSchema>;

/** Service list rows carry the product name for display. */
export const serviceWithProductSchema = serviceSchema.extend({
  productName: z.string().optional(),
});
export type ServiceWithProduct = z.infer<typeof serviceWithProductSchema>;

export const cancelServiceSchema = z.object({
  /** Cancel now (status `cancelled`) instead of at the end of the paid term. */
  immediate: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});
export type CancelService = z.infer<typeof cancelServiceSchema>;

export const prorationResultSchema = z.object({
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  daysInPeriod: z.number().int(),
  daysRemaining: z.number().int(),
  credit: minorUnitsSchema,
  charge: minorUnitsSchema,
  net: minorUnitsSchema,
  currency: currencyCodeSchema,
  ratio: z.number(),
});

export const changeServicePackageResultSchema = z.object({
  service: serviceWithProductSchema,
  proration: prorationResultSchema,
  invoiceId: uuidSchema.nullable(),
});
export type ChangeServicePackageResult = z.infer<typeof changeServicePackageResultSchema>;

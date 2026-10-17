import { z } from 'zod';
import {
  billingCycleSchema,
  currencyCodeSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

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

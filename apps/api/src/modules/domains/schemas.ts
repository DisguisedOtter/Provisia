import { uuidSchema } from '@provisia/shared';
import { z } from 'zod';

export {
  adminUpdateDomainSchema,
  availabilityQuerySchema,
  availabilityResponseSchema,
  createDomainContactHandleSchema,
  createTldSchema,
  dataSchema,
  domainActionResponseSchema,
  domainAlertSchema,
  domainContactHandleSchema,
  domainListQuerySchema,
  domainSchema,
  domainSyncLogSchema,
  eppCodeResponseSchema,
  importTldPricingSchema,
  paginatedSchema,
  paginationQuerySchema,
  portalDomainSchema,
  publicTldSchema,
  registerDomainRequestSchema,
  registrarAccountSchema,
  registrarModuleInfoSchema,
  renewDomainRequestSchema,
  tldWithPricesSchema,
  transferDomainRequestSchema,
  updateDomainContactHandleSchema,
  updateDomainSchema,
  updateTldSchema,
  upsertRegistrarAccountSchema,
} from '@provisia/shared';

export const idParamsSchema = z.object({ id: uuidSchema });
export const moduleParamsSchema = z.object({ module: z.string().min(1).max(50) });

export const tldListQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
  registrarModule: z.string().optional(),
  search: z.string().max(63).optional(),
});

export const contactListQuerySchema = z.object({ clientId: uuidSchema.optional() });

export const alertListQuerySchema = z.object({
  acknowledged: z.coerce.boolean().default(false),
  domainId: uuidSchema.optional(),
});

export const jobResponseSchema = z.object({
  data: z.object({ queue: z.literal('domains'), name: z.string(), id: z.string() }),
});

/** Admin "mark status" endpoint body. */
export const setStatusSchema = z.object({
  status: z.enum([
    'pending',
    'pending_registration',
    'pending_transfer',
    'active',
    'expired',
    'redemption',
    'cancelled',
    'transferred_away',
  ]),
  reason: z.string().max(500).optional(),
  force: z.boolean().default(false),
});

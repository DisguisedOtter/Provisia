import { z } from 'zod';

export {
  clientContactSchema,
  clientListQuerySchema,
  clientSchema,
  clientWithUserSchema,
  createClientContactSchema,
  createClientSchema,
  creditAdjustmentResultSchema,
  creditAdjustmentSchema,
  dataSchema,
  paginatedSchema,
  paginationQuerySchema,
  transactionSchema,
  updateClientContactSchema,
  updateClientSchema,
  vatValidationResultSchema,
} from '@provisia/shared';

export const clientIdParams = z.object({ id: z.uuid() });
export const contactParams = z.object({ id: z.uuid(), contactId: z.uuid() });
export const vatValidateBody = z.object({ force: z.boolean().default(false) }).nullish();

/** Portal self-service profile fields (no status, credit or tax override). */
export const updatePortalProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  companyName: z.string().max(200).nullable().optional(),
  vatNumber: z.string().max(32).nullable().optional(),
  address1: z.string().max(200).optional(),
  address2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().length(2).toUpperCase().optional(),
  phone: z.string().max(40).nullable().optional(),
  language: z.string().max(10).optional(),
});
export type UpdatePortalProfile = z.infer<typeof updatePortalProfileSchema>;

import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  emailSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const clientStatusSchema = z.enum(['active', 'inactive', 'closed']);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const clientSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyName: z.string().nullable(),
  vatNumber: z.string().nullable(),
  vatValidated: z.boolean(),
  vatValidatedAt: timestampSchema.nullable(),
  vatCheckedAt: timestampSchema.nullable().optional(),
  taxExempt: z.boolean().optional(),
  address1: z.string(),
  address2: z.string().nullable(),
  city: z.string(),
  postalCode: z.string(),
  state: z.string().nullable(),
  country: countryCodeSchema,
  phone: z.string().nullable(),
  language: z.string(),
  currency: currencyCodeSchema,
  creditBalance: minorUnitsSchema,
  status: clientStatusSchema,
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Client = z.infer<typeof clientSchema>;

export const createClientSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyName: z.string().max(200).nullable().optional(),
  vatNumber: z.string().max(32).nullable().optional(),
  address1: z.string().max(200).default(''),
  address2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).default(''),
  postalCode: z.string().max(20).default(''),
  state: z.string().max(100).nullable().optional(),
  country: countryCodeSchema.default('NL'),
  phone: z.string().max(40).nullable().optional(),
  language: z.string().max(10).default('en'),
  currency: currencyCodeSchema.default('EUR'),
  notes: z.string().nullable().optional(),
});
export type CreateClient = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema
  .omit({ email: true, password: true })
  .partial()
  .extend({
    status: clientStatusSchema.optional(),
    taxExempt: z.boolean().optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
  });
export type UpdateClient = z.infer<typeof updateClientSchema>;

/** Client plus its login user's name/email, as the admin list and detail show it. */
export const clientWithUserSchema = clientSchema.extend({
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
});
export type ClientWithUser = z.infer<typeof clientWithUserSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  status: clientStatusSchema.optional(),
  /** Case-insensitive match on company name, email, first or last name. */
  search: z.string().max(100).optional(),
  country: countryCodeSchema.optional(),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

export const clientContactPermissionsSchema = z.object({
  services: z.boolean(),
  domains: z.boolean(),
  invoices: z.boolean(),
  tickets: z.boolean(),
  profile: z.boolean(),
});
export type ClientContactPermissions = z.infer<typeof clientContactPermissionsSchema>;

export const clientContactSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  userId: uuidSchema.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  email: emailSchema,
  phone: z.string().nullable(),
  permissions: clientContactPermissionsSchema,
  receivesInvoiceEmails: z.boolean(),
  receivesSupportEmails: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ClientContact = z.infer<typeof clientContactSchema>;

export const createClientContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: emailSchema,
  phone: z.string().max(40).nullable().optional(),
  permissions: clientContactPermissionsSchema.partial().optional(),
  receivesInvoiceEmails: z.boolean().default(false),
  receivesSupportEmails: z.boolean().default(false),
});
export type CreateClientContact = z.infer<typeof createClientContactSchema>;

export const updateClientContactSchema = createClientContactSchema.partial();
export type UpdateClientContact = z.infer<typeof updateClientContactSchema>;

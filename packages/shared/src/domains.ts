import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  emailSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const domainStatusSchema = z.enum([
  'pending',
  'pending_transfer',
  'active',
  'expired',
  'cancelled',
  'transferred_away',
]);
export type DomainStatus = z.infer<typeof domainStatusSchema>;

export const domainNameSchema = z
  .string()
  .min(3)
  .max(255)
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/, 'invalid domain name');

export const domainContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  organization: z.string().max(200).optional(),
  email: emailSchema,
  phone: z.string().min(1).max(40),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  state: z.string().max(100).optional(),
  country: countryCodeSchema,
});
export type DomainContact = z.infer<typeof domainContactSchema>;

export const domainContactsSchema = z.object({
  registrant: domainContactSchema,
  admin: domainContactSchema.optional(),
  tech: domainContactSchema.optional(),
  billing: domainContactSchema.optional(),
});
export type DomainContacts = z.infer<typeof domainContactsSchema>;

/** EPP code is never included in the DTO; it has its own endpoint. */
export const domainSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  name: domainNameSchema,
  tld: z.string(),
  registrarModule: z.string().nullable(),
  status: domainStatusSchema,
  registrationDate: isoDateSchema.nullable(),
  expiryDate: isoDateSchema.nullable(),
  nextDueDate: isoDateSchema.nullable(),
  registrationPeriod: z.number().int(),
  recurringAmount: minorUnitsSchema,
  currency: currencyCodeSchema,
  nameservers: z.array(z.string()),
  autoRenew: z.boolean(),
  locked: z.boolean(),
  idProtection: z.boolean(),
  contacts: domainContactsSchema.nullable(),
  moduleData: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Domain = z.infer<typeof domainSchema>;

export const updateDomainSchema = z.object({
  nameservers: z.array(z.string().max(255)).max(13).optional(),
  autoRenew: z.boolean().optional(),
  locked: z.boolean().optional(),
  idProtection: z.boolean().optional(),
  contacts: domainContactsSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  status: domainStatusSchema.optional(),
});
export type UpdateDomain = z.infer<typeof updateDomainSchema>;

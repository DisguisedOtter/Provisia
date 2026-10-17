import { z } from 'zod';

export const uuidSchema = z.uuid();
export const emailSchema = z.email().max(255).toLowerCase();
export const currencyCodeSchema = z.string().length(3).toUpperCase();
export const countryCodeSchema = z.string().length(2).toUpperCase();
/** ISO date `YYYY-MM-DD` as stored in `date` columns. */
export const isoDateSchema = z.iso.date();
export const timestampSchema = z.coerce.date();
/** Integer minor units (cents). Never a float. */
export const minorUnitsSchema = z.number().int();

export const billingCycleSchema = z.enum([
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
  'onetime',
]);
export type BillingCycle = z.infer<typeof billingCycleSchema>;

/** Months per billing cycle; `onetime` is 0. */
export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannually: 6,
  annually: 12,
  biennially: 24,
  triennially: 36,
  onetime: 0,
};

export const userRoleSchema = z.enum(['admin', 'staff', 'client']);
export type UserRole = z.infer<typeof userRoleSchema>;

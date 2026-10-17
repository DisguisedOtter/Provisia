import { z } from 'zod';

export const mollieMethodSchema = z.enum([
  'ideal',
  'banktransfer',
  'creditcard',
  'bancontact',
  'paypal',
  'sofort',
  'directdebit',
]);

export const mollieConfigSchema = z.object({
  /** `test_...` or `live_...` API key from the Mollie dashboard. */
  apiKey: z
    .string()
    .min(1)
    .regex(/^(test|live)_/, 'Mollie API keys start with test_ or live_'),
  /** Methods offered at checkout; empty = every method enabled in the Mollie dashboard. */
  methods: z
    .array(mollieMethodSchema)
    .default(['ideal', 'banktransfer', 'creditcard', 'bancontact']),
  /** Amount in minor units for the first (mandate-creating) payment; Mollie requires >= 0.01 for iDEAL. */
  mandateAmount: z.number().int().min(0).default(1),
  /** Locale for the hosted checkout, e.g. `nl_NL`. */
  locale: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/)
    .optional(),
  /** Days a bank transfer stays payable (Mollie `dueDate`), 1-100. */
  bankTransferDueDays: z.number().int().min(1).max(100).default(14),
  /** Override for tests / mocks only. */
  apiBaseUrl: z.url().default('https://api.mollie.com'),
});
export type MollieConfig = z.infer<typeof mollieConfigSchema>;

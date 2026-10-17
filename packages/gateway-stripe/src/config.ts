import { z } from 'zod';

export const stripePaymentMethodSchema = z.enum(['card', 'sepa_debit', 'ideal', 'bancontact']);

export const stripeConfigSchema = z.object({
  /** `sk_test_...` / `sk_live_...` */
  secretKey: z.string().min(1).startsWith('sk_'),
  /** `pk_test_...` / `pk_live_...`; returned to the browser for Elements. */
  publishableKey: z.string().min(1).startsWith('pk_'),
  /** `whsec_...` from the webhook endpoint you create for `/api/v1/public/webhooks/stripe`. */
  webhookSecret: z.string().min(1).startsWith('whsec_'),
  /** `checkout` redirects to Stripe Checkout; `payment_intent` returns a client secret for Elements. */
  flow: z.enum(['checkout', 'payment_intent']).default('checkout'),
  paymentMethods: z
    .array(stripePaymentMethodSchema)
    .min(1)
    .default(['card', 'sepa_debit', 'ideal']),
  /** Statement descriptor suffix shown on card statements (max 22 chars). */
  statementDescriptor: z.string().max(22).optional(),
  /** Override for tests / mocks only. */
  apiBaseUrl: z.url().default('https://api.stripe.com'),
  /** Seconds a webhook timestamp may deviate from now before it is rejected. */
  webhookToleranceSeconds: z.number().int().min(0).default(300),
});
export type StripeConfig = z.infer<typeof stripeConfigSchema>;

/** Payment method types Stripe accepts in `mode=setup` Checkout Sessions (iDEAL setup yields a SEPA mandate). */
export const SETUP_CAPABLE_METHODS = new Set(['card', 'sepa_debit', 'ideal', 'bancontact']);

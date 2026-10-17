import { z } from 'zod';

export const paypalConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** `sandbox` uses api-m.sandbox.paypal.com, `live` uses api-m.paypal.com. */
  mode: z.enum(['sandbox', 'live']).default('sandbox'),
  /** Id of the webhook you created in the PayPal developer dashboard (needed for signature verification). */
  webhookId: z.string().min(1),
  brandName: z.string().max(127).optional(),
  /** Override for tests / mocks only; derived from `mode` when empty. */
  apiBaseUrl: z.url().optional(),
});
export type PaypalConfig = z.infer<typeof paypalConfigSchema>;

export function paypalBaseUrl(config: PaypalConfig): string {
  if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/$/, '');
  return config.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

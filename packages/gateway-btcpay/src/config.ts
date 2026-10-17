import { z } from 'zod';

export const btcpayConfigSchema = z.object({
  /** Base URL of your BTCPay Server, e.g. `https://btcpay.example.com`. */
  serverUrl: z.url(),
  storeId: z.string().min(1),
  /** Greenfield API key with `btcpay.store.cancreateinvoice`, `btcpay.store.canviewinvoices`, `btcpay.store.cancreatenonapprovedpullpayments`, `btcpay.store.canviewstoresettings`. */
  apiKey: z.string().min(1),
  /** Secret entered when creating the store webhook; used to verify `BTCPay-Sig`. */
  webhookSecret: z.string().min(1),
  /** Invoice expiration in minutes (BTCPay default 15). */
  expirationMinutes: z.number().int().min(1).max(1440).optional(),
  /** `HighSpeed` (0 conf), `MediumSpeed` (1), `LowMediumSpeed` (2), `LowSpeed` (6). Empty = store default. */
  speedPolicy: z.enum(['HighSpeed', 'MediumSpeed', 'LowMediumSpeed', 'LowSpeed']).optional(),
});
export type BtcpayConfig = z.infer<typeof btcpayConfigSchema>;

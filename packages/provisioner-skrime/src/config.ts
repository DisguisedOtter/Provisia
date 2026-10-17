import { z } from 'zod';

/**
 * Server-level credentials: the Skrime reseller account. Create one "server" per Skrime account with the
 * module `skrime_webspace` and/or `skrime_server` (the same key may be used for both and for the registrar).
 */
export const skrimeCredentialsSchema = z.object({
  /** Personal API token from skrime.eu → API Schnittstelle. */
  apiKey: z.string().min(10),
  /** Override to point at a mock server. */
  baseUrl: z.url().default('https://skrime.eu/api'),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});
export type SkrimeCredentials = z.infer<typeof skrimeCredentialsSchema>;

/** Product-level configuration for resold webspace. */
export const skrimeWebspaceConfigSchema = z.object({
  /** Skrime package id/name, e.g. from `listRemoteOptions('package')`. */
  package: z.string().min(1).max(100),
  /**
   * Skrime has no suspend call for webspace. `password` (default) locks the client out of the panel by
   * rotating the password; `none` only marks the service suspended in Provisia.
   */
  suspendMode: z.enum(['password', 'none']).default('password'),
});
export type SkrimeWebspaceConfig = z.infer<typeof skrimeWebspaceConfigSchema>;

/** Product-level configuration for resold KVM servers. */
export const skrimeServerConfigSchema = z.object({
  /** Skrime plan id/name, e.g. from `listRemoteOptions('plan')`. */
  plan: z.string().min(1).max(100),
  /** OS image id/name, e.g. from `listRemoteOptions('image')`. */
  image: z.string().min(1).max(100),
  /** Hostname when the service has no domain: `<prefix><service id suffix>`. */
  hostnamePrefix: z.string().max(20).default('vps-'),
  /** Suspend by powering the server off (Skrime has no suspend call). */
  suspendMode: z.enum(['power_off', 'none']).default('power_off'),
});
export type SkrimeServerConfig = z.infer<typeof skrimeServerConfigSchema>;

/** Persisted in `services.module_data` for webspace services. */
export interface SkrimeWebspaceData {
  /** Skrime product id. */
  productId: string;
  package: string;
  domain: string;
  panelUrl?: string;
  username?: string;
  /** Skrime's recurring price in minor units, recorded at order time (reseller margin reporting). */
  costAmount?: number;
  costCurrency?: string;
  cancelledAt?: string;
}

/** Persisted in `services.module_data` for server services. */
export interface SkrimeServerData {
  productId: string;
  plan: string;
  image: string;
  hostname: string;
  ip?: string;
  costAmount?: number;
  costCurrency?: string;
  cancelledAt?: string;
}

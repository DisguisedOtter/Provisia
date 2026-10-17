import { z } from 'zod';

/**
 * Server-level credentials: the Skrime reseller account. Create one "server" per Skrime account with the
 * module `skrime_webspace` and/or `skrime_server` (the same key may back both and the registrar).
 */
export const skrimeCredentialsSchema = z.object({
  /** API token from skrime.eu → dashboard → API. */
  apiKey: z.string().min(10),
  /** Override to point at a mock server. */
  baseUrl: z.url().default('https://skrime.eu/api'),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  /** GET parameters as query string (default) or as JSON body (how Skrime documents it). */
  getParamsIn: z.enum(['query', 'body']).default('query'),
});
export type SkrimeCredentials = z.infer<typeof skrimeCredentialsSchema>;

const renewalSchema = z
  .enum(['autorenew', 'manual'])
  .default('autorenew')
  .describe(
    'autorenew: Skrime renews the product from the reseller balance (set after ordering). manual: nothing is set; renew through product/renew yourself.',
  );

/** Product-level configuration for resold webspace. */
export const skrimeWebspaceConfigSchema = z.object({
  /** Skrime plan id (UUID) from `listRemoteOptions('plan')` = `GET webspace/pricelist`. */
  planId: z.string().min(1).max(100),
  renewal: renewalSchema,
  /**
   * Skrime has no suspend call for webspace. `password` (default) locks the client out of the panel by
   * rotating the password; `none` only marks the service suspended in Provisia.
   */
  suspendMode: z.enum(['password', 'none']).default('password'),
});
export type SkrimeWebspaceConfig = z.infer<typeof skrimeWebspaceConfigSchema>;

/** Product-level configuration for resold KVM servers: a fixed plan or a configurator spec. */
export const skrimeServerConfigSchema = z
  .object({
    /** Fixed plan id (UUID) from `listRemoteOptions('plan')` = `GET server/pricelist`. */
    planId: z.string().max(100).optional(),
    /** Configurator (used when `planId` is empty): vCPU cores. */
    cores: z.number().int().min(1).max(64).optional(),
    /** Configurator: memory in GB. */
    memoryGb: z.number().int().min(1).max(512).optional(),
    /** Configurator: disk in GB. */
    diskGb: z.number().int().min(10).max(4000).optional(),
    ipv4: z.number().int().min(0).max(16).default(1),
    ipv6: z.number().int().min(0).max(16).default(1),
    /** Configurator: port speed in Gbit/s. */
    connection: z.number().int().min(1).max(100).default(10),
    /** OS `proxmoxId`, id or name from `listRemoteOptions('image')` = `GET server/os`, e.g. `debian-12`. */
    osName: z.string().min(1).max(100),
    /** Months paid up front at Skrime per order (1, 2, 3, 6, 12, 24). */
    prepayMonths: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(12), z.literal(24)])
      .default(1),
    renewal: renewalSchema,
    /** Suspend by powering the server off (Skrime has no suspend call). */
    suspendMode: z.enum(['power_off', 'none']).default('power_off'),
    /** Hostname / Skrime product name when the service has no domain: `<prefix><service id suffix>`. */
    hostnamePrefix: z.string().max(20).default('vps-'),
  })
  .refine((c) => c.planId || (c.cores && c.memoryGb && c.diskGb), {
    message: 'Set planId or the configurator fields cores, memoryGb and diskGb',
    path: ['planId'],
  });
export type SkrimeServerConfig = z.infer<typeof skrimeServerConfigSchema>;

/** Persisted in `services.module_data` for webspace services. */
export interface SkrimeWebspaceData {
  productId: string;
  planId: string;
  planName?: string;
  /** Panel host, e.g. `vweb12.skrime.eu`. */
  panelHost?: string;
  username?: string;
  ipv4?: string;
  ipv6?: string;
  /** Skrime's recurring price in cents (reseller margin reporting). */
  costAmount?: number;
  costCurrency?: string;
  expireAt?: string;
  cancelledAt?: string;
}

/** Persisted in `services.module_data` for server services. */
export interface SkrimeServerData {
  productId: string;
  planId?: string;
  osName: string;
  hostname: string;
  cores?: number;
  memoryMb?: number;
  diskGb?: number;
  ipv4?: string;
  ipv6?: string;
  costAmount?: number;
  costCurrency?: string;
  expireAt?: string;
  cancelledAt?: string;
}

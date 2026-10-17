import { z } from 'zod';

/** Product-level configuration (stored in `products.module_config`). */
export const pleskConfigSchema = z.object({
  /** Service plan name as shown in Plesk (Service Plans » Hosting Plans). */
  servicePlan: z.string().min(1).max(255),
  /**
   * Create a dedicated Plesk customer per service (recommended). When false the subscription is
   * owned by the API user (admin/reseller) and SSO logs in as the subscription's system user.
   */
  createCustomer: z.boolean().default(true),
  /** Fixed IPv4 address for the subscription; empty = let Plesk pick the shared IP. */
  ipAddress: z.string().max(45).optional(),
  /** Pre-fill the SSO login link with the client's IP (Plesk binds the key to it when set). */
  bindLoginToIp: z.boolean().default(false),
});
export type PleskConfig = z.infer<typeof pleskConfigSchema>;

/** Server-level credentials: API key (preferred) or admin/reseller basic auth. */
export const pleskCredentialsSchema = z
  .object({
    /** From `POST /api/v2/auth/keys` or `plesk bin secret_key --create`. */
    apiKey: z.string().min(8).optional(),
    username: z.string().min(1).max(64).optional(),
    password: z.string().min(1).optional(),
  })
  .refine((c) => Boolean(c.apiKey) || Boolean(c.username && c.password), {
    message: 'Provide apiKey or username + password',
  });
export type PleskCredentials = z.infer<typeof pleskCredentialsSchema>;

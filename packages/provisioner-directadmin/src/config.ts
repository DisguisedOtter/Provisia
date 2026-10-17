import { z } from 'zod';

/** Product-level configuration (stored in `products.module_config`). */
export const directadminConfigSchema = z.object({
  /** User package name (Reseller Level » Manage User Packages). */
  package: z.string().min(1).max(100),
  /** `shared` picks the reseller's shared IP, `server` the server IP, or a literal IPv4/IPv6. */
  ip: z.string().min(1).max(45).default('shared'),
  /** Send DirectAdmin's own welcome mail (`notify=yes`). Provisia sends its own, so default off. */
  notify: z.boolean().default(false),
  /** Validity of one-time SSO links. */
  loginKeyExpiry: z
    .string()
    .regex(/^\d+[mhd]$/, 'e.g. 30m, 2h')
    .default('30m'),
});
export type DirectadminConfig = z.infer<typeof directadminConfigSchema>;

/** Server-level credentials. */
export const directadminCredentialsSchema = z.object({
  /** Admin or reseller user that owns the created accounts. */
  username: z.string().min(1).max(64),
  /** Login key (Admin Level » Login Keys) or the account password. */
  loginKey: z.string().min(8),
});
export type DirectadminCredentials = z.infer<typeof directadminCredentialsSchema>;

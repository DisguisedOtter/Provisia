import { z } from 'zod';

/** Product-level configuration (stored in `products.module_config`). */
export const cpanelConfigSchema = z.object({
  /** WHM package name (from `listpkgs`), e.g. `starter`. */
  package: z.string().min(1).max(100),
  /** Create the account as a reseller (`reseller=1` on createacct). */
  reseller: z.boolean().default(false),
  /** Optional WHM ACL list name applied to reseller accounts (`setacls`). */
  aclList: z.string().max(100).optional(),
  /** Panel to open with the SSO link. */
  loginService: z.enum(['cpaneld', 'whostmgrd', 'webmaild']).default('cpaneld'),
  /** Keep DNS zone when terminating (`keepdns=1`). */
  keepDns: z.boolean().default(false),
});
export type CpanelConfig = z.infer<typeof cpanelConfigSchema>;

/** Server-level credentials (encrypted at rest in `servers.credentials_encrypted`). */
export const cpanelCredentialsSchema = z.object({
  /** WHM user the API token belongs to; `root` or a reseller. */
  username: z.string().min(1).max(64).default('root'),
  /** WHM API token (Home » Development » Manage API Tokens). */
  apiToken: z.string().min(8),
});
export type CpanelCredentials = z.infer<typeof cpanelCredentialsSchema>;

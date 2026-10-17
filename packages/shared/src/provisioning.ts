import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { serverSchema } from './servers.js';

/* ------------------------------------------------------------------ server groups */

/** How a server is picked inside a group when a new service is provisioned. */
export const serverGroupFillTypeSchema = z.enum(['least_loaded', 'fill_first']);
export type ServerGroupFillType = z.infer<typeof serverGroupFillTypeSchema>;

export const serverGroupSchema = z.object({
  id: uuidSchema,
  /** Matches `servers.groupName` and `products.serverGroup`. */
  name: z.string(),
  description: z.string().nullable(),
  fillType: serverGroupFillTypeSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ServerGroup = z.infer<typeof serverGroupSchema>;

export const createServerGroupSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, 'letters, digits, space, _ . - only'),
  description: z.string().max(1000).nullable().optional(),
  fillType: serverGroupFillTypeSchema.default('least_loaded'),
});
export type CreateServerGroup = z.infer<typeof createServerGroupSchema>;

export const updateServerGroupSchema = createServerGroupSchema.partial();
export type UpdateServerGroup = z.infer<typeof updateServerGroupSchema>;

/** Group with its servers and their load, for the capacity view. */
export const serverGroupWithServersSchema = serverGroupSchema.extend({
  servers: z.array(z.lazy(() => serverCapacitySchema)),
});
export type ServerGroupWithServers = z.infer<typeof serverGroupWithServersSchema>;

/* ------------------------------------------------------------------ servers */

/** Last connection test result, stored on the server row. */
export const serverStatusSchema = z.object({
  checkedAt: timestampSchema.nullable(),
  ok: z.boolean().nullable(),
  message: z.string().nullable(),
});

/** Server plus how many services are using it. */
export const serverCapacitySchema = serverSchema.extend({
  status: serverStatusSchema,
  activeServices: z.number().int(),
  /** Includes pending + active + suspended services. */
  usedAccounts: z.number().int(),
  /** `null` when `maxAccounts` is 0 (unlimited). */
  freeAccounts: z.number().int().nullable(),
  full: z.boolean(),
});
export type ServerCapacity = z.infer<typeof serverCapacitySchema>;

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

/** Kinds of remote options a server can enumerate (not every module supports every kind). */
export const remoteOptionKindSchema = z.enum([
  'packages',
  'plans',
  'templates',
  'nodes',
  'storages',
  'bridges',
]);
export type RemoteOptionKind = z.infer<typeof remoteOptionKindSchema>;

export const remoteOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  extra: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type RemoteOption = z.infer<typeof remoteOptionSchema>;

/** Module descriptor for the admin UI: which config fields a product / server needs. */
export const provisionerDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  /** JSON Schema of the product-level config (from the module's zod `configSchema`). */
  configSchema: z.record(z.string(), z.unknown()),
  /** JSON Schema of the server credentials, when the module declares one. */
  credentialsSchema: z.record(z.string(), z.unknown()).nullable(),
  capabilities: z.object({
    changePackage: z.boolean(),
    changePassword: z.boolean(),
    usage: z.boolean(),
    loginUrl: z.boolean(),
    power: z.boolean(),
    remoteOptions: z.boolean(),
  }),
});
export type ProvisionerDescriptor = z.infer<typeof provisionerDescriptorSchema>;

/* ------------------------------------------------------------------ provisioning actions */

export const provisioningActionSchema = z.enum([
  'create',
  'suspend',
  'unsuspend',
  'terminate',
  'changePackage',
  'changePassword',
  'syncUsage',
  'power',
]);
export type ProvisioningAction = z.infer<typeof provisioningActionSchema>;

export const powerActionSchema = z.enum(['start', 'stop', 'shutdown', 'reboot']);
export type PowerAction = z.infer<typeof powerActionSchema>;

export const provisioningLogStatusSchema = z.enum(['success', 'failed']);

export const provisioningLogSchema = z.object({
  id: uuidSchema,
  serviceId: uuidSchema.nullable(),
  serverId: uuidSchema.nullable(),
  action: z.string(),
  status: provisioningLogStatusSchema,
  message: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  actorUserId: uuidSchema.nullable(),
  attempt: z.number().int(),
  durationMs: z.number().int().nullable(),
  createdAt: timestampSchema,
});
export type ProvisioningLog = z.infer<typeof provisioningLogSchema>;

/** Last synced resource usage of a service. */
export const serviceUsageSchema = z.object({
  serviceId: uuidSchema,
  diskUsedMb: z.number().nullable(),
  diskLimitMb: z.number().nullable(),
  bandwidthUsedMb: z.number().nullable(),
  bandwidthLimitMb: z.number().nullable(),
  extra: z.record(z.string(), z.union([z.number(), z.string()])),
  syncedAt: timestampSchema,
});
export type ServiceUsage = z.infer<typeof serviceUsageSchema>;

/** Response of every action endpoint that enqueues a job. */
export const queuedJobSchema = z.object({
  jobId: z.string(),
  queue: z.literal('provisioning'),
  name: provisioningActionSchema,
  serviceId: uuidSchema,
});
export type QueuedJob = z.infer<typeof queuedJobSchema>;

export const provisioningSuspendBodySchema = z.object({
  reason: z.string().max(500).optional(),
});
export const provisioningChangePackageBodySchema = z.object({
  productId: uuidSchema,
});
export const provisioningChangePasswordBodySchema = z.object({
  /** Omit to let the system generate one. */
  password: z.string().min(10).max(128).optional(),
});
export const provisioningPowerBodySchema = z.object({
  action: powerActionSchema,
});
export const provisioningCreateBodySchema = z.object({
  /** Force a specific server instead of picking the least-loaded one in the product's group. */
  serverId: uuidSchema.optional(),
});

export const provisioningLoginUrlSchema = z.object({
  url: z.url(),
  /** Seconds the link is expected to stay valid (panel dependent). */
  expiresIn: z.number().int().optional(),
});
export type ProvisioningLoginUrl = z.infer<typeof provisioningLoginUrlSchema>;

/** Settings keys used by the provisioning worker (defaults applied by parseSettings via extension). */
export const PROVISIONING_DEFAULTS = {
  /** Max seconds an HTTP-side wait for a worker result (test connection, login URL) may take. */
  syncWaitSeconds: 30,
  /** Default panel password length when the system generates one. */
  passwordLength: 20,
} as const;

/* ------------------------------------------------------------------ helpers (browser-safe) */

/**
 * Derives a panel username from a domain: lowercase alphanumerics, no leading digit, max `maxLength`
 * characters (cPanel/DirectAdmin limit is 8 for old installs, 16 on current ones).
 */
export function deriveUsername(domain: string | null | undefined, maxLength = 8): string {
  const base = (domain ?? '')
    .toLowerCase()
    .split('.')[0]
    ?.replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  const name = base && base.length > 0 ? base : 'user';
  const trimmed = name.slice(0, maxLength);
  // cPanel refuses usernames starting with "test"; prefix to be safe.
  return /^test/.test(trimmed) ? `u${trimmed}`.slice(0, maxLength) : trimmed;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_=+';

/** Cryptographically random password containing at least one upper, lower, digit and symbol. */
export function generatePassword(length: number = PROVISIONING_DEFAULTS.passwordLength): string {
  const len = Math.max(12, length);
  const bytes = new Uint32Array(len);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += PASSWORD_ALPHABET[(bytes[i] as number) % PASSWORD_ALPHABET.length];
    }
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[0-9]/.test(out) && /[^A-Za-z0-9]/.test(out)) {
      return out;
    }
  }
}

export interface ServerCandidate {
  id: string;
  name: string;
  maxAccounts: number;
  usedAccounts: number;
}

/**
 * Picks the server for a new service. `least_loaded` = lowest fill ratio (lowest absolute count when
 * unlimited), `fill_first` = first server (by name) that still has room. Full servers (`maxAccounts > 0`
 * and `usedAccounts >= maxAccounts`) are never picked. Returns null when nothing fits.
 */
export function pickServer<T extends ServerCandidate>(
  candidates: T[],
  fillType: ServerGroupFillType = 'least_loaded',
): T | null {
  const open = candidates.filter((c) => c.maxAccounts <= 0 || c.usedAccounts < c.maxAccounts);
  if (open.length === 0) return null;
  const byName = [...open].sort((a, b) => a.name.localeCompare(b.name));
  if (fillType === 'fill_first') return byName[0] ?? null;
  const load = (c: ServerCandidate) =>
    c.maxAccounts > 0 ? c.usedAccounts / c.maxAccounts : c.usedAccounts / 1_000_000;
  return byName.reduce((best, c) => (load(c) < load(best) ? c : best));
}

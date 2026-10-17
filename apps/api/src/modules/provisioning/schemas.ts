import { paginationQuerySchema, uuidSchema } from '@provisia/shared';
import { z } from 'zod';

export {
  dataSchema,
  paginatedSchema,
  provisioningChangePackageBodySchema,
  provisioningChangePasswordBodySchema,
  provisioningCreateBodySchema,
  provisioningLoginUrlSchema,
  provisioningLogSchema,
  provisioningPowerBodySchema,
  provisioningSuspendBodySchema,
  queuedJobSchema,
  serviceUsageSchema,
} from '@provisia/shared';

export const idParamsSchema = z.object({ id: uuidSchema });

export const logQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(50).optional(),
  status: z.enum(['success', 'failed']).optional(),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

/** What the portal may see of a service's provisioning state. */
export const portalProvisioningInfoSchema = z.object({
  serviceId: uuidSchema,
  module: z.string().nullable(),
  capabilities: z.object({
    loginUrl: z.boolean(),
    resetPassword: z.boolean(),
    power: z.boolean(),
    usage: z.boolean(),
  }),
  username: z.string().nullable(),
  ipAddress: z.string().nullable(),
  /** Proxmox: last known power state from the usage sync (`running` / `stopped`). */
  powerState: z.string().nullable(),
});
export type PortalProvisioningInfo = z.infer<typeof portalProvisioningInfoSchema>;

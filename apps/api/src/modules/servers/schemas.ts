import {
  paginationQuerySchema,
  serverCapacitySchema,
  serverGroupWithServersSchema,
  uuidSchema,
} from '@provisia/shared';
import { z } from 'zod';

export {
  createServerGroupSchema,
  createServerSchema,
  dataSchema,
  paginatedSchema,
  provisionerDescriptorSchema,
  remoteOptionKindSchema,
  remoteOptionSchema,
  serverCapacitySchema,
  serverGroupSchema,
  testConnectionResultSchema,
  updateServerGroupSchema,
  updateServerSchema,
} from '@provisia/shared';

export const idParamsSchema = z.object({ id: uuidSchema });

export const serverListQuerySchema = paginationQuerySchema.extend({
  module: z.string().max(50).optional(),
  groupName: z.string().max(100).optional(),
  active: z.coerce.boolean().optional(),
});
export type ServerListQuery = z.infer<typeof serverListQuerySchema>;

export const optionsParamsSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['packages', 'plans', 'templates', 'nodes', 'storages', 'bridges']),
});

/** Free-form hints for discovery (e.g. `?node=pve2` for Proxmox templates). */
export const optionsQuerySchema = z.record(z.string(), z.string());

export const capacityResponseSchema = z.object({
  data: z.object({
    groups: z.array(serverGroupWithServersSchema),
    ungrouped: z.array(serverCapacitySchema),
  }),
});

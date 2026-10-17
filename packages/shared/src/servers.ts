import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

/** Credentials are never returned by the API. */
export const serverSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  module: z.string(),
  hostname: z.string(),
  ipAddress: z.string().nullable(),
  port: z.number().int().nullable(),
  secure: z.boolean(),
  nameservers: z.array(z.string()),
  groupName: z.string().nullable(),
  maxAccounts: z.number().int(),
  active: z.boolean(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Server = z.infer<typeof serverSchema>;

export const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  module: z.string().min(1).max(50),
  hostname: z.string().min(1).max(255),
  ipAddress: z.string().max(45).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  secure: z.boolean().default(true),
  /** Validated against the provisioner's configSchema, then encrypted at rest. */
  credentials: z.record(z.string(), z.unknown()),
  nameservers: z.array(z.string().max(255)).default([]),
  groupName: z.string().max(100).nullable().optional(),
  maxAccounts: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});
export type CreateServer = z.infer<typeof createServerSchema>;

export const updateServerSchema = createServerSchema.partial();
export type UpdateServer = z.infer<typeof updateServerSchema>;

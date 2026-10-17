import { z } from 'zod';
import { emailSchema, timestampSchema, userRoleSchema, uuidSchema } from './common.js';

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  role: userRoleSchema,
  firstName: z.string(),
  lastName: z.string(),
  active: z.boolean(),
  emailVerifiedAt: timestampSchema.nullable(),
  lastLoginAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
  role: userRoleSchema.default('client'),
  firstName: z.string().max(100).default(''),
  lastName: z.string().max(100).default(''),
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.omit({ password: true }).partial().extend({
  active: z.boolean().optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

export const roleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  userCount: z.number().int().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Role = z.infer<typeof roleSchema>;

export const roleSummarySchema = roleSchema.pick({ id: true, name: true });

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string().regex(/^(\*|[a-z]+\.(\*|[a-z_]+))$/)).default([]),
});
export type CreateRole = z.infer<typeof createRoleSchema>;
export const updateRoleSchema = createRoleSchema.partial();
export type UpdateRole = z.infer<typeof updateRoleSchema>;

export const permissionDescriptorSchema = z.object({
  key: z.string(),
  area: z.string(),
  action: z.string(),
  description: z.string(),
});
export type PermissionDescriptor = z.infer<typeof permissionDescriptorSchema>;

// ---------------------------------------------------------------------------------------------
// Staff users (admin + staff roles)
// ---------------------------------------------------------------------------------------------

export const staffRoleSchema = z.enum(['admin', 'staff']);

export const staffUserSchema = userSchema.extend({
  roles: z.array(roleSummarySchema),
  totpEnabled: z.boolean(),
  /** Set while an invite is outstanding (no password chosen yet). */
  invitePending: z.boolean(),
});
export type StaffUser = z.infer<typeof staffUserSchema>;

export const createStaffUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(200),
  role: staffRoleSchema.default('staff'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleIds: z.array(uuidSchema).default([]),
});
export type CreateStaffUser = z.infer<typeof createStaffUserSchema>;

export const inviteStaffUserSchema = createStaffUserSchema.omit({ password: true });
export type InviteStaffUser = z.infer<typeof inviteStaffUserSchema>;

export const updateStaffUserSchema = z.object({
  email: emailSchema.optional(),
  role: staffRoleSchema.optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
  roleIds: z.array(uuidSchema).optional(),
});
export type UpdateStaffUser = z.infer<typeof updateStaffUserSchema>;

export const staffListQuerySchema = z.object({
  search: z.string().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
  role: staffRoleSchema.optional(),
});

// ---------------------------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------------------------

export const apiKeySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: timestampSchema.nullable(),
  lastUsedIp: z.string().nullable(),
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  /** Defaults to `['*']` = everything the owning user may do. */
  scopes: z
    .array(z.string().regex(/^(\*|[a-z]+\.(\*|[a-z_]+))$/))
    .min(1)
    .default(['*']),
  expiresAt: timestampSchema.nullable().optional(),
});
export type CreateApiKey = z.infer<typeof createApiKeySchema>;

/** Returned once, on creation: the row plus the plaintext token. */
export const createdApiKeySchema = apiKeySchema.extend({ token: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

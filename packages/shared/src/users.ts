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

export const apiKeySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: timestampSchema.nullable().optional(),
});

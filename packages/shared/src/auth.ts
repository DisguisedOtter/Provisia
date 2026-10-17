import { z } from 'zod';
import { emailSchema } from './common.js';
import { userSchema } from './users.js';

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Required when the user has TOTP enabled. */
  totpCode: z.string().length(6).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** `/auth/me` and the login response: the user plus the client id when role is `client`. */
export const authUserSchema = userSchema.extend({
  clientId: z.uuid().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({ data: authUserSchema });
export const meResponseSchema = z.object({ data: authUserSchema });

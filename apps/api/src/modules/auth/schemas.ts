// Request/response schemas for this module live in @provisia/shared/auth so the web app shares them.
import { z } from 'zod';

export {
  acceptInviteRequestSchema,
  apiKeySchema,
  changeOwnPasswordRequestSchema,
  createApiKeySchema,
  createdApiKeySchema,
  forgotPasswordRequestSchema,
  impersonateRequestSchema,
  login2faRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  resetPasswordRequestSchema,
  sessionSchema,
  totpCodeSchema,
  totpConfirmResponseSchema,
  totpDisableRequestSchema,
  totpSetupResponseSchema,
  totpStatusSchema,
  verifyEmailRequestSchema,
} from '@provisia/shared';

export const idParamsSchema = z.object({ id: z.uuid() });
export const tokenQuerySchema = z.object({ token: z.string().min(16).max(200) });
export const tokenValiditySchema = z.object({
  data: z.object({ valid: z.boolean(), email: z.string().nullable() }),
});
export const resendVerificationSchema = z.object({ email: z.email().max(255).toLowerCase() });
export const okSchema = z.object({ data: z.object({ ok: z.literal(true) }) });

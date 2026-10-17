import { z } from 'zod';

/** Stable machine-readable error codes. Feature modules may add their own `snake_case` codes. */
export const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const ErrorCodes = {
  validation_error: 400,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
} as const;
export type KnownErrorCode = keyof typeof ErrorCodes;

/**
 * Error classes thrown by the Skrime client. `code` is stable and machine readable so the
 * domains worker can decide between "retry later", "tell the admin" and "tell the client".
 */
export type SkrimeErrorCode =
  | 'auth_failed'
  | 'not_found'
  | 'domain_unavailable'
  | 'insufficient_funds'
  | 'invalid_auth_code'
  | 'rate_limited'
  | 'validation_failed'
  | 'unsupported'
  | 'upstream_error'
  | 'network_error'
  | 'invalid_response';

export class SkrimeError extends Error {
  constructor(
    public readonly code: SkrimeErrorCode,
    message: string,
    public readonly httpStatus?: number,
    /** True when a later retry may succeed (5xx, timeouts, rate limits). */
    public readonly retryable: boolean = false,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'SkrimeError';
  }
}

export function isSkrimeError(err: unknown): err is SkrimeError {
  return err instanceof SkrimeError;
}

/**
 * Maps a `state: "error"` response message to a stable code. Skrime returns free text in
 * `response`, so this is a best-effort keyword match; unknown messages become `upstream_error`.
 */
export function classifyMessage(message: string): SkrimeErrorCode {
  const m = message.toLowerCase();
  if (m.includes('no product found') || m.includes('not found')) return 'not_found';
  if (m.includes('authcode') || m.includes('auth code') || m.includes('auth-code'))
    return 'invalid_auth_code';
  if (
    m.includes('not available') ||
    m.includes('already registered') ||
    m.includes('unavailable') ||
    m.includes('taken')
  )
    return 'domain_unavailable';
  if (
    m.includes('balance') ||
    m.includes('credit') ||
    m.includes('insufficient') ||
    m.includes('guthaben')
  )
    return 'insufficient_funds';
  if (m.includes('unauthorized') || m.includes('api key') || m.includes('token'))
    return 'auth_failed';
  if (m.includes('invalid') || m.includes('required') || m.includes('missing'))
    return 'validation_failed';
  return 'upstream_error';
}

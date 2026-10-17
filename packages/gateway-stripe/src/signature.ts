import { createHmac, timingSafeEqual } from 'node:crypto';

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

/** Parses `t=...,v1=...,v1=...` into its parts. */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v) timestamp = Number(v);
    else if (k === 'v1' && v) signatures.push(v);
  }
  return { timestamp, signatures };
}

export function computeSignature(
  timestamp: number,
  payload: Buffer | string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest('hex');
}

/**
 * Verifies the `stripe-signature` header exactly like stripe-node does: HMAC-SHA256 of `${t}.${rawBody}`
 * with the endpoint secret, compared in constant time, and the timestamp inside the tolerance window.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): void {
  if (!header) throw new StripeSignatureError('missing stripe-signature header');
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new StripeSignatureError('malformed stripe-signature header');
  }
  const expected = Buffer.from(computeSignature(timestamp, rawBody, secret), 'hex');
  const matches = signatures.some((sig) => {
    const candidate = Buffer.from(sig, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matches) throw new StripeSignatureError('stripe-signature does not match payload');
  if (toleranceSeconds > 0 && Math.abs(now - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError('stripe-signature timestamp outside tolerance');
  }
}

/** Test helper: builds a valid header for a payload. */
export function signPayload(
  payload: Buffer | string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(timestamp, payload, secret)}`;
}

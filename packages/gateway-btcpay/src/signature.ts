import { createHmac, timingSafeEqual } from 'node:crypto';

export class BtcpaySignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BtcpaySignatureError';
  }
}

export function computeBtcpaySignature(rawBody: Buffer | string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Verifies `BTCPay-Sig: sha256=<hex hmac of the raw body>` in constant time. */
export function verifyBtcpaySignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): void {
  if (!header) throw new BtcpaySignatureError('missing BTCPay-Sig header');
  const expected = Buffer.from(computeBtcpaySignature(rawBody, secret));
  const actual = Buffer.from(header.trim());
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new BtcpaySignatureError('BTCPay-Sig does not match payload');
  }
}

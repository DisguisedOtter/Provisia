import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '@provisia/module-sdk';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const TOTP_OPTS = { algorithm: 'SHA1', digits: 6, period: 30 } as const;
/** Accept one step of clock drift on either side. */
const WINDOW = 1;
const BACKUP_CODE_COUNT = 10;
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotp(secretBase32: string, label: string, issuer: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    ...TOTP_OPTS,
  });
}

export function otpauthUrl(secretBase32: string, label: string, issuer: string): string {
  return buildTotp(secretBase32, label, issuer).toString();
}

export async function otpauthQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 200 });
}

/** Validates a 6-digit code against the secret (±1 period). */
export function verifyTotpCode(secretBase32: string, code: string, now = Date.now()): boolean {
  return totpStep(secretBase32, code, now) !== null;
}

/**
 * The time step (unix time / period) the code belongs to, or `null` when it does not validate (±1 period).
 * Store the accepted step and reject anything at or below it to make every code single-use.
 */
export function totpStep(secretBase32: string, code: string, now = Date.now()): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const totp = buildTotp(secretBase32, 'x', 'x');
  const delta = totp.validate({ token: normalized, window: WINDOW, timestamp: now });
  if (delta === null) return null;
  return Math.floor(now / 1000 / TOTP_OPTS.period) + delta;
}

/** Current code; for tests and the CLI only. */
export function currentTotpCode(secretBase32: string, now = Date.now()): string {
  return buildTotp(secretBase32, 'x', 'x').generate({ timestamp: now });
}

export const encryptTotpSecret = (secret: string) => encrypt(secret);
export const decryptTotpSecret = (payload: string) => decrypt(payload);

/** `XXXXX-XXXXX` codes; 50 bits of entropy each. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let s = '';
    for (const b of bytes) s += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash('sha256')
    .update(code.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');
}

/** Returns the remaining hashes when `code` matches one of them, or null. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  const h = Buffer.from(hashBackupCode(code), 'hex');
  const idx = hashes.findIndex((stored) => {
    const b = Buffer.from(stored, 'hex');
    return b.length === h.length && timingSafeEqual(b, h);
  });
  if (idx === -1) return null;
  return hashes.filter((_, i) => i !== idx);
}

/** Heuristic: 6 digits → TOTP, anything else → backup code. */
export function looksLikeBackupCode(code: string): boolean {
  return !/^\d{6}$/.test(code.replace(/\s+/g, ''));
}

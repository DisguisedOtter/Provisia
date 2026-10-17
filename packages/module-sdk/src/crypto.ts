import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';

/**
 * Resolves the 32-byte key from `APP_KEY` (64 hex chars, or 44-char base64).
 * Pass the key explicitly in tests; production code relies on the env var.
 */
export function resolveAppKey(key: string | undefined = process.env.APP_KEY): Buffer {
  if (!key) throw new Error('APP_KEY is not set');
  const buf = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, 'hex') : Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('APP_KEY must be 32 bytes (64 hex characters)');
  return buf;
}

/** AES-256-GCM. Output: `enc:v1:<base64(iv || ciphertext || tag)>`. */
export function encrypt(plaintext: string, key?: string): string {
  const k = resolveAppKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

export function decrypt(payload: string, key?: string): string {
  if (!payload.startsWith(PREFIX)) throw new Error('not an encrypted payload');
  const k = resolveAppKey(key);
  const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('encrypted payload too short');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ct = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptJson(value: unknown, key?: string): string {
  return encrypt(JSON.stringify(value), key);
}

export function decryptJson<T = unknown>(payload: string, key?: string): T {
  return JSON.parse(decrypt(payload, key)) as T;
}

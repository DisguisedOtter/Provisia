import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, isEncrypted } from './crypto.js';

const key = randomBytes(32).toString('hex');

describe('crypto', () => {
  it('round-trips text', () => {
    const ct = encrypt('s3cret-pässword', key);
    expect(ct.startsWith('enc:v1:')).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(decrypt(ct, key)).toBe('s3cret-pässword');
  });

  it('uses a fresh IV every time', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('round-trips JSON', () => {
    const value = { user: 'root', token: 'abc', port: 2087 };
    expect(decryptJson(encryptJson(value, key), key)).toEqual(value);
  });

  it('rejects tampering and wrong keys', () => {
    const ct = encrypt('hello', key);
    const raw = Buffer.from(ct.slice('enc:v1:'.length), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] as number) ^ 0xff;
    expect(() => decrypt(`enc:v1:${raw.toString('base64')}`, key)).toThrow();
    expect(() => decrypt(ct, randomBytes(32).toString('hex'))).toThrow();
    expect(() => decrypt('plain', key)).toThrow(/not an encrypted payload/);
  });

  it('validates the key', () => {
    expect(() => encrypt('x', 'short')).toThrow(/32 bytes/);
    expect(() => encrypt('x', '')).toThrow(/APP_KEY/);
  });
});

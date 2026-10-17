import { describe, expect, it } from 'vitest';
import {
  consumeBackupCode,
  currentTotpCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  looksLikeBackupCode,
  otpauthUrl,
  verifyTotpCode,
} from './totp.js';

describe('totp', () => {
  it('generates a base32 secret and a valid otpauth url', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const url = otpauthUrl(secret, 'me@example.com', 'Provisia Hosting');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain('issuer=Provisia%20Hosting');
    expect(url).toContain(`secret=${secret}`);
  });

  it('accepts the current code and ±1 step, rejects others', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = currentTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
    expect(verifyTotpCode(secret, code, now + 30_000)).toBe(true);
    expect(verifyTotpCode(secret, code, now - 30_000)).toBe(true);
    expect(verifyTotpCode(secret, code, now + 90_000)).toBe(false);
    expect(verifyTotpCode(secret, '000000', now)).toBe(code === '000000');
    expect(verifyTotpCode(secret, 'abcdef', now)).toBe(false);
    expect(verifyTotpCode(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, now)).toBe(true);
  });

  it('backup codes: unique, consumed once, case/dash insensitive', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const hashes = codes.map(hashBackupCode);
    const first = codes[0] as string;
    const remaining = consumeBackupCode(hashes, first.toLowerCase().replace('-', ''));
    expect(remaining).toHaveLength(9);
    expect(consumeBackupCode(remaining ?? [], first)).toBeNull();
    expect(consumeBackupCode(hashes, 'NOPE1-NOPE2')).toBeNull();
    expect(looksLikeBackupCode(first)).toBe(true);
    expect(looksLikeBackupCode('123456')).toBe(false);
  });
});

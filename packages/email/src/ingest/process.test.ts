import { describe, expect, it } from 'vitest';
import { senderAuthenticated } from './process.js';

const mail = (results: string | undefined, address = 'ops@example.com') => ({
  headers: (results ? { 'authentication-results': results } : {}) as Record<string, string>,
  from: { address, name: 'Ops' },
});

describe('senderAuthenticated', () => {
  it('is false without an Authentication-Results header (From alone is forgeable)', () => {
    expect(senderAuthenticated(mail(undefined))).toBe(false);
  });

  it('accepts dmarc=pass', () => {
    expect(senderAuthenticated(mail('mx.provisia.test; dmarc=pass header.from=example.com'))).toBe(
      true,
    );
  });

  it('accepts dkim=pass only when the signing domain matches the sender domain', () => {
    expect(senderAuthenticated(mail('mx; dkim=pass header.d=example.com'))).toBe(true);
    expect(senderAuthenticated(mail('mx; dkim=pass header.i=@mail.example.com'))).toBe(true);
    expect(senderAuthenticated(mail('mx; dkim=pass header.d=attacker.example'))).toBe(false);
  });

  it('accepts spf=pass only for the sender domain and rejects fails', () => {
    expect(
      senderAuthenticated(mail('mx; spf=pass smtp.mailfrom=bounce@example.com; dkim=none')),
    ).toBe(true);
    expect(senderAuthenticated(mail('mx; spf=pass smtp.mailfrom=attacker.example'))).toBe(false);
    expect(senderAuthenticated(mail('mx; spf=fail smtp.mailfrom=example.com; dkim=fail'))).toBe(
      false,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { deriveUsername, generatePassword, pickServer } from './provisioning.js';

describe('deriveUsername', () => {
  it('derives short lowercase names without leading digits', () => {
    expect(deriveUsername('Example-Client.test')).toBe('examplec');
    expect(deriveUsername('123abc.nl')).toBe('abc');
    expect(deriveUsername('999.nl')).toBe('user');
    expect(deriveUsername(null)).toBe('user');
    expect(deriveUsername('testing.com')).toBe('utesting');
    expect(deriveUsername('verylongdomainname.com', 16)).toBe('verylongdomainna');
  });
});

describe('generatePassword', () => {
  it('generates strong passwords of the requested length', () => {
    const p = generatePassword(24);
    expect(p).toHaveLength(24);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).toMatch(/[^A-Za-z0-9]/);
    expect(generatePassword(4)).toHaveLength(12);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe('pickServer', () => {
  const servers = [
    { id: 'a', name: 'alpha', maxAccounts: 10, usedAccounts: 9 },
    { id: 'b', name: 'beta', maxAccounts: 100, usedAccounts: 50 },
    { id: 'c', name: 'gamma', maxAccounts: 10, usedAccounts: 10 },
    { id: 'd', name: 'delta', maxAccounts: 0, usedAccounts: 3 },
  ];
  it('picks the least loaded and skips full servers', () => {
    expect(pickServer(servers)?.id).toBe('d');
    expect(pickServer(servers.filter((s) => s.id !== 'd'))?.id).toBe('b');
  });
  it('fill_first takes the first non-full by name', () => {
    expect(pickServer(servers, 'fill_first')?.id).toBe('a');
  });
  it('returns null when everything is full', () => {
    expect(pickServer([servers[2] as (typeof servers)[number]])).toBeNull();
    expect(pickServer([])).toBeNull();
  });
});

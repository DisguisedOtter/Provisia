import { describe, expect, it } from 'vitest';
import { isWeakSecret, loadConfig } from './config.js';

const strong = {
  DATABASE_URL: 'postgres://x:y@localhost:5432/db',
  APP_KEY: 'f3a9c1d2e4b5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  SESSION_SECRET: 'q8Zr2vL0pX4nW7tC1yH6sK9uJ3eM5bA2dF8gV1kN0',
};

describe('isWeakSecret', () => {
  it('flags the documented placeholders and low-entropy values', () => {
    expect(isWeakSecret('replace-with-openssl-rand-hex-32')).toBe(true);
    expect(isWeakSecret('change-me-to-a-long-random-string')).toBe(true);
    expect(isWeakSecret('0'.repeat(64))).toBe(true);
    expect(isWeakSecret('abcdabcdabcdabcdabcdabcdabcdabcdabcd')).toBe(true);
  });
  it('accepts random secrets', () => {
    expect(isWeakSecret(strong.APP_KEY)).toBe(false);
    expect(isWeakSecret(strong.SESSION_SECRET)).toBe(false);
  });
});

describe('loadConfig in production', () => {
  it('refuses weak APP_KEY / SESSION_SECRET', () => {
    expect(() =>
      loadConfig({ ...strong, NODE_ENV: 'production', APP_KEY: '0'.repeat(64) }),
    ).toThrow(/weak secrets/);
    expect(() =>
      loadConfig({
        ...strong,
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-me-to-a-long-random-string',
      }),
    ).toThrow(/SESSION_SECRET/);
  });
  it('accepts strong secrets and tolerates placeholders outside production', () => {
    expect(loadConfig({ ...strong, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
    expect(
      loadConfig({ ...strong, NODE_ENV: 'development', APP_KEY: '0'.repeat(64) }).APP_KEY,
    ).toBe('0'.repeat(64));
  });
});

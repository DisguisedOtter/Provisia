import { describe, expect, it } from 'vitest';
import { LoginLockout, MemoryLockoutStore } from './auth-lockout.js';

const policy = { accountAttempts: 3, ipAttempts: 5, windowSeconds: 60, lockSeconds: 120 };

describe('LoginLockout', () => {
  it('locks the account after N failures and releases after the lock expires', async () => {
    let now = 1_000_000;
    const store = new MemoryLockoutStore(() => now);
    const l = new LoginLockout(store, policy);
    expect(await l.check('1.1.1.1', 'A@example.com')).toEqual({ locked: false });
    expect(await l.fail('1.1.1.1', 'a@example.com')).toEqual({ locked: false });
    expect(await l.fail('1.1.1.1', 'a@example.com')).toEqual({ locked: false });
    const third = await l.fail('1.1.1.1', 'a@example.com');
    expect(third).toMatchObject({ locked: true, scope: 'account', retryAfterSeconds: 120 });
    // Different IP, same account: still locked (case-insensitive email).
    expect(await l.check('9.9.9.9', 'A@EXAMPLE.com')).toMatchObject({
      locked: true,
      scope: 'account',
    });
    now += 121_000;
    expect(await l.check('9.9.9.9', 'a@example.com')).toEqual({ locked: false });
  });

  it('locks the IP across accounts and resets counters on success', async () => {
    const store = new MemoryLockoutStore();
    const l = new LoginLockout(store, policy);
    for (let i = 0; i < 4; i++) {
      expect(await l.fail('2.2.2.2', `user${i}@example.com`)).toEqual({ locked: false });
    }
    expect(await l.fail('2.2.2.2', 'user9@example.com')).toMatchObject({
      locked: true,
      scope: 'ip',
    });
    expect(await l.check('2.2.2.2', 'other@example.com')).toMatchObject({
      locked: true,
      scope: 'ip',
    });

    const l2 = new LoginLockout(new MemoryLockoutStore(), policy);
    await l2.fail('3.3.3.3', 'b@example.com');
    await l2.fail('3.3.3.3', 'b@example.com');
    await l2.succeed('3.3.3.3', 'b@example.com');
    await l2.fail('3.3.3.3', 'b@example.com');
    expect(await l2.fail('3.3.3.3', 'b@example.com')).toEqual({ locked: false });
  });

  it('fails open when the store throws, reporting the error', async () => {
    const errors: unknown[] = [];
    const broken = {
      incr: async () => {
        throw new Error('redis down');
      },
      expire: async () => 1,
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => 'OK',
      del: async () => 1,
      ttl: async () => -2,
    };
    const l = new LoginLockout(broken, policy, (e) => errors.push(e));
    expect(await l.check('4.4.4.4', 'x@example.com')).toEqual({ locked: false });
    expect(await l.fail('4.4.4.4', 'x@example.com')).toEqual({ locked: false });
    expect(errors).toHaveLength(2);
  });

  it('admin unlock clears the account lock', async () => {
    const store = new MemoryLockoutStore();
    const l = new LoginLockout(store, policy);
    for (let i = 0; i < 3; i++) await l.fail('5.5.5.5', 'c@example.com');
    expect((await l.check('5.5.5.5', 'c@example.com')).locked).toBe(true);
    await l.unlockAccount('C@example.com');
    expect((await l.check('5.5.5.5', 'c@example.com')).locked).toBe(false);
  });
});

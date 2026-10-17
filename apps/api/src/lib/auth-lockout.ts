/**
 * Login brute-force protection backed by Redis: a per-IP and a per-account failure counter inside a
 * sliding window. When a counter crosses its threshold the subject is locked for `lockoutDurationMinutes`.
 * Counters are cleared on a successful login. If Redis is unreachable the check fails open (logged), so an
 * outage cannot lock everyone out; the per-route rate limit still applies.
 */
export interface LockoutStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

export interface LockoutPolicy {
  accountAttempts: number;
  ipAttempts: number;
  windowSeconds: number;
  lockSeconds: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  accountAttempts: 5,
  ipAttempts: 20,
  windowSeconds: 15 * 60,
  lockSeconds: 15 * 60,
};

export type LockoutStatus =
  | { locked: false }
  | { locked: true; scope: 'account' | 'ip'; retryAfterSeconds: number };

const PREFIX = 'auth:lockout';
const keys = {
  ipFail: (ip: string) => `${PREFIX}:ip:${ip}:fails`,
  ipLock: (ip: string) => `${PREFIX}:ip:${ip}:lock`,
  acctFail: (email: string) => `${PREFIX}:acct:${email}:fails`,
  acctLock: (email: string) => `${PREFIX}:acct:${email}:lock`,
};

export class LoginLockout {
  constructor(
    private readonly store: LockoutStore,
    private readonly policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  async check(ip: string, email: string): Promise<LockoutStatus> {
    try {
      const acct = await this.store.get(keys.acctLock(email.toLowerCase()));
      if (acct) {
        const ttl = await this.store.ttl(keys.acctLock(email.toLowerCase()));
        return { locked: true, scope: 'account', retryAfterSeconds: Math.max(ttl, 1) };
      }
      const ipLock = await this.store.get(keys.ipLock(ip));
      if (ipLock) {
        const ttl = await this.store.ttl(keys.ipLock(ip));
        return { locked: true, scope: 'ip', retryAfterSeconds: Math.max(ttl, 1) };
      }
      return { locked: false };
    } catch (err) {
      this.onError(err);
      return { locked: false };
    }
  }

  /** Records a failed attempt; returns the status after recording (locked when a threshold was crossed). */
  async fail(ip: string, email: string): Promise<LockoutStatus> {
    const normalized = email.toLowerCase();
    try {
      const [acctFails, ipFails] = await Promise.all([
        this.bump(keys.acctFail(normalized)),
        this.bump(keys.ipFail(ip)),
      ]);
      if (acctFails >= this.policy.accountAttempts) {
        await this.store.set(keys.acctLock(normalized), '1', 'EX', this.policy.lockSeconds);
        await this.store.del(keys.acctFail(normalized));
        return { locked: true, scope: 'account', retryAfterSeconds: this.policy.lockSeconds };
      }
      if (ipFails >= this.policy.ipAttempts) {
        await this.store.set(keys.ipLock(ip), '1', 'EX', this.policy.lockSeconds);
        await this.store.del(keys.ipFail(ip));
        return { locked: true, scope: 'ip', retryAfterSeconds: this.policy.lockSeconds };
      }
      return { locked: false };
    } catch (err) {
      this.onError(err);
      return { locked: false };
    }
  }

  async succeed(ip: string, email: string): Promise<void> {
    try {
      await this.store.del(keys.acctFail(email.toLowerCase()), keys.ipFail(ip));
    } catch (err) {
      this.onError(err);
    }
  }

  /** Admin action: clear the lock for an account. */
  async unlockAccount(email: string): Promise<void> {
    await this.store.del(keys.acctLock(email.toLowerCase()), keys.acctFail(email.toLowerCase()));
  }

  private async bump(key: string): Promise<number> {
    const n = await this.store.incr(key);
    if (n === 1) await this.store.expire(key, this.policy.windowSeconds);
    return n;
  }
}

/** Minimal in-memory store with TTLs, for unit tests and single-process fallbacks. */
export class MemoryLockoutStore implements LockoutStore {
  private readonly data = new Map<string, { value: string; expiresAt: number | null }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async incr(key: string) {
    const e = this.live(key);
    const next = (e ? Number(e.value) : 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
    return next;
  }
  async expire(key: string, seconds: number) {
    const e = this.live(key);
    if (e) e.expiresAt = this.now() + seconds * 1000;
    return 1;
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async set(key: string, value: string, _mode: 'EX', seconds: number) {
    this.data.set(key, { value, expiresAt: this.now() + seconds * 1000 });
    return 'OK';
  }
  async del(...keys: string[]) {
    for (const k of keys) this.data.delete(k);
    return keys.length;
  }
  async ttl(key: string) {
    const e = this.live(key);
    if (!e) return -2;
    if (e.expiresAt === null) return -1;
    return Math.ceil((e.expiresAt - this.now()) / 1000);
  }
}

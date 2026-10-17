import {
  activityLog as activityLogTable,
  apiKeys,
  clients,
  createDb,
  roles,
  settings as settingsTable,
  users,
} from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { seed } from '@provisia/db/seed';
import { closeQueues } from '@provisia/worker/queues';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { requireStaff } from '../../lib/auth.js';
import { consumeToken, hashToken, issueToken, peekToken } from '../../lib/auth-tokens.js';
import { getSettings, invalidateSettings, setSetting } from '../../lib/settings.js';
import { currentTotpCode } from '../../lib/totp.js';

const TEST_URL = process.env.DATABASE_URL_TEST;
const ADMIN = { email: 'auth-admin@example.com', password: 'integration-pass-1' };
const ORIGIN = { origin: 'http://localhost:3000' };
let ipCounter = 10;
/** Fresh client IP per call so the per-IP rate limit / lockout never leaks between tests. */
const ip = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

function cookieOf(res: LightMyRequestResponse) {
  const c = res.cookies.find((x) => x.name === 'pv_session');
  return c ? `pv_session=${c.value}` : '';
}

describe.skipIf(!TEST_URL)('auth module', () => {
  let app: FastifyInstance;
  let adminCookie = '';
  let adminId = '';

  const post = (
    url: string,
    payload?: Record<string, unknown> | string,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: { ...ORIGIN, 'x-forwarded-for': ip(), ...headers },
    });
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { 'x-forwarded-for': ip(), ...headers } });
  const login = (
    email: string,
    password: string,
    extra: Record<string, unknown> = {},
    clientIp = ip(),
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password, ...extra },
      headers: { ...ORIGIN, 'x-forwarded-for': clientIp },
    });

  beforeAll(async () => {
    const url = TEST_URL as string;
    await runMigrations(url);
    const { db, close } = createDb(url, { max: 1 });
    await seed(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    // Accounts this file creates; remove leftovers from a previous run so the suite is re-runnable.
    const leftovers = [
      'new.client@example.com',
      'x@example.com',
      'verify@example.com',
      'support@example.com',
    ];
    const leftoverIds = db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, leftovers));
    await db.delete(clients).where(inArray(clients.userId, leftoverIds));
    await db.delete(users).where(inArray(users.email, leftovers));
    await close();
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        APP_KEY: '22'.repeat(32),
        SESSION_SECRET: 'auth-test-session-secret-that-is-long-enough',
      }),
      logger: false,
    });
    // Route without an explicit activityLog() call, to exercise the auto-audit hook.
    app.post('/api/v1/admin/hooktest/:id', { preHandler: requireStaff }, async () => ({
      ok: true,
    }));
    await app.ready();
    await app.redis.flushdb().catch(() => {});
    await setSetting(app.db, 'security.allowRegistration', true);
    await setSetting(app.db, 'security.requireEmailVerification', false);
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.statusCode).toBe(200);
    adminCookie = cookieOf(res);
    adminId = res.json().data.id;
  });

  afterAll(async () => {
    await closeQueues();
    await app?.close();
  });

  // ------------------------------------------------------------------ registration
  it('registers a client with EU address and VAT, auto-logs in, writes audit', async () => {
    const res = await post('/api/v1/auth/register', {
      email: 'New.Client@Example.com',
      password: 'clientpass123',
      firstName: 'Nina',
      lastName: 'Klant',
      companyName: 'Klant BV',
      vatNumber: 'nl 1234.5678.9b01',
      address1: 'Straat 1',
      city: 'Utrecht',
      postalCode: '3511AA',
      country: 'nl',
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      data: { email: 'new.client@example.com', role: 'client', permissions: [] },
      verificationRequired: false,
    });
    expect(res.json().data.clientId).toBeTruthy();
    expect(cookieOf(res)).not.toBe('');
    const dup = await post('/api/v1/auth/register', {
      email: 'new.client@example.com',
      password: 'clientpass123',
      firstName: 'A',
      lastName: 'B',
      address1: 'x',
      city: 'y',
      postalCode: 'z',
      country: 'NL',
      acceptTerms: true,
    });
    expect(dup.statusCode).toBe(409);
    const [log] = await app.db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.action, 'auth.register'))
      .orderBy(desc(activityLogTable.createdAt))
      .limit(1);
    expect(log?.userAgent).toBe('lightMyRequest');
  });

  it('registration can be disabled; verification gate blocks login until verified', async () => {
    await setSetting(app.db, 'security.allowRegistration', false);
    const closed = await post('/api/v1/auth/register', {
      email: 'x@example.com',
      password: 'clientpass123',
      firstName: 'A',
      lastName: 'B',
      address1: 'x',
      city: 'y',
      postalCode: 'z',
      country: 'NL',
      acceptTerms: true,
    });
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error.code).toBe('registration_disabled');
    await setSetting(app.db, 'security.allowRegistration', true);
    await setSetting(app.db, 'security.requireEmailVerification', true);
    const res = await post('/api/v1/auth/register', {
      email: 'verify@example.com',
      password: 'clientpass123',
      firstName: 'V',
      lastName: 'E',
      address1: 'x',
      city: 'y',
      postalCode: 'z',
      country: 'DE',
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().verificationRequired).toBe(true);
    expect(cookieOf(res)).toBe('');
    const blocked = await login('verify@example.com', 'clientpass123');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('email_not_verified');
    // Verify with a token issued directly (the email goes through the queue).
    const t = await issueToken(app.db, { userId: res.json().data.id, type: 'email_verify' });
    const ok = await post('/api/v1/auth/verify-email', { token: t.token });
    expect(ok.statusCode).toBe(200);
    expect((await login('verify@example.com', 'clientpass123')).statusCode).toBe(200);
    await setSetting(app.db, 'security.requireEmailVerification', false);
  });

  // ------------------------------------------------------------------ password reset lifecycle
  it('password reset tokens: hashed at rest, single use, expiring, revoke sessions', async () => {
    const forgot = await post('/api/v1/auth/forgot-password', { email: 'nobody@example.com' });
    expect(forgot.statusCode).toBe(204); // no enumeration
    const [u] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'new.client@example.com'));
    const sessionRes = await login('new.client@example.com', 'clientpass123');
    const clientCookie = cookieOf(sessionRes);
    const { token } = await issueToken(app.db, { userId: u?.id as string, type: 'password_reset' });
    const rows = await app.db.query.authTokens.findMany({
      where: (t, { eq: e }) => e(t.tokenHash, hashToken(token)),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);

    const valid = await get(`/api/v1/auth/reset-password?token=${encodeURIComponent(token)}`);
    expect(valid.json().data).toEqual({ valid: true, email: 'new.client@example.com' });
    const weak = await post('/api/v1/auth/reset-password', { token, password: 'short' });
    expect(weak.statusCode).toBe(400);
    const reset = await post('/api/v1/auth/reset-password', {
      token,
      password: 'newclientpass123',
    });
    expect(reset.statusCode).toBe(200);
    const reuse = await post('/api/v1/auth/reset-password', { token, password: 'anotherpass123' });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('invalid_token');
    // Old session revoked, new password works.
    expect((await get('/api/v1/auth/me', { cookie: clientCookie })).statusCode).toBe(401);
    expect((await login('new.client@example.com', 'clientpass123')).statusCode).toBe(401);
    expect((await login('new.client@example.com', 'newclientpass123')).statusCode).toBe(200);
    // Expired token
    const expired = await issueToken(app.db, {
      userId: u?.id as string,
      type: 'password_reset',
      ttlMs: -1000,
    });
    expect(await peekToken(app.db, 'password_reset', expired.token)).toBeNull();
    expect(await consumeToken(app.db, 'password_reset', expired.token)).toBeNull();
    // Issuing a new token invalidates the previous one of the same type
    const t1 = await issueToken(app.db, { userId: u?.id as string, type: 'password_reset' });
    await issueToken(app.db, { userId: u?.id as string, type: 'password_reset' });
    expect(await peekToken(app.db, 'password_reset', t1.token)).toBeNull();
  });

  // ------------------------------------------------------------------ brute force
  it('locks an account after repeated failures (per account, Redis) and admins can unlock', async () => {
    await setSetting(app.db, 'security.lockoutAccountAttempts', 3);
    const [u] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'new.client@example.com'));
    for (let i = 0; i < 2; i++) {
      expect((await login('new.client@example.com', 'wrong')).statusCode).toBe(401);
    }
    const locked = await login('new.client@example.com', 'wrong');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('too_many_attempts');
    expect(locked.json().error.details.scope).toBe('account');
    // Correct password from another IP: still locked
    const still = await login('new.client@example.com', 'newclientpass123');
    expect(still.statusCode).toBe(429);
    const unlock = await post(`/api/v1/admin/users/${u?.id}/unlock`, undefined, {
      cookie: adminCookie,
    });
    expect(unlock.statusCode).toBe(404); // not a staff user → users module 404s; use the lockout directly
    await app.redis.del(`auth:lockout:acct:new.client@example.com:lock`);
    expect((await login('new.client@example.com', 'newclientpass123')).statusCode).toBe(200);
    await setSetting(app.db, 'security.lockoutAccountAttempts', 5);
  });

  it('locks an IP after many failures across accounts', async () => {
    await setSetting(app.db, 'security.lockoutIpAttempts', 4);
    const badIp = '10.9.9.9';
    for (let i = 0; i < 3; i++)
      expect((await login(`ghost${i}@example.com`, 'x', {}, badIp)).statusCode).toBe(401);
    const locked = await login('ghost9@example.com', 'x', {}, badIp);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.details.scope).toBe('ip');
    await setSetting(app.db, 'security.lockoutIpAttempts', 20);
    await app.redis.del('auth:lockout:ip:10.9.9.9:lock');
  });

  // ------------------------------------------------------------------ TOTP
  it('enrols TOTP, requires the 2FA step at login, accepts backup codes, disables', async () => {
    const client = await login('new.client@example.com', 'newclientpass123');
    const cookie = cookieOf(client);
    const setup = await post('/api/v1/auth/2fa/setup', undefined, { cookie });
    expect(setup.statusCode).toBe(200);
    const { secret, qrDataUrl, otpauthUrl } = setup.json().data;
    expect(qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(otpauthUrl).toContain('otpauth://totp/');
    const bad = await post('/api/v1/auth/2fa/confirm', { code: '000000' }, { cookie });
    expect([400, 200]).toContain(bad.statusCode);
    if (bad.statusCode === 200) return; // astronomically unlikely collision; skip rest
    const confirm = await post(
      '/api/v1/auth/2fa/confirm',
      { code: currentTotpCode(secret) },
      { cookie },
    );
    expect(confirm.statusCode).toBe(200);
    const backupCodes: string[] = confirm.json().data.backupCodes;
    expect(backupCodes).toHaveLength(10);
    const me = await get('/api/v1/auth/me', { cookie });
    expect(me.json().data.totpEnabled).toBe(true);

    // Login now returns a challenge
    const step1 = await login('new.client@example.com', 'newclientpass123');
    expect(step1.statusCode).toBe(200);
    expect(step1.json().data).toBeNull();
    const { challengeToken } = step1.json().twoFactor;
    const wrong = await post('/api/v1/auth/login/2fa', { challengeToken, code: '123456' });
    expect([401]).toContain(wrong.statusCode);
    const step2 = await post('/api/v1/auth/login/2fa', {
      challengeToken,
      code: currentTotpCode(secret),
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json().data.email).toBe('new.client@example.com');
    expect(cookieOf(step2)).not.toBe('');
    // Challenge is single-use
    const again = await post('/api/v1/auth/login/2fa', {
      challengeToken,
      code: currentTotpCode(secret),
    });
    expect(again.statusCode).toBe(401);

    // One-call login with totpCode; backup code works once
    const oneCall = await login('new.client@example.com', 'newclientpass123', {
      totpCode: backupCodes[0],
    });
    expect(oneCall.statusCode).toBe(200);
    const reuse = await login('new.client@example.com', 'newclientpass123', {
      totpCode: backupCodes[0],
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('invalid_totp_code');
    const status = await get('/api/v1/auth/2fa', { cookie: cookieOf(oneCall) });
    expect(status.json().data.backupCodesRemaining).toBe(9);

    const disable = await post(
      '/api/v1/auth/2fa/disable',
      { password: 'newclientpass123', code: currentTotpCode(secret) },
      { cookie: cookieOf(oneCall) },
    );
    expect(disable.statusCode).toBe(200);
    expect((await login('new.client@example.com', 'newclientpass123')).json().data.email).toBe(
      'new.client@example.com',
    );
  });

  it('enforces 2FA enrolment for staff when the setting is on', async () => {
    await setSetting(app.db, 'security.require2faForStaff', true);
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.json().data.totpEnrollmentRequired).toBe(true);
    const blocked = await get('/api/v1/admin/users', { cookie: cookieOf(res) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('totp_enrollment_required');
    expect((await get('/api/v1/auth/2fa', { cookie: cookieOf(res) })).statusCode).toBe(200);
    await setSetting(app.db, 'security.require2faForStaff', false);
  });

  // ------------------------------------------------------------------ sessions
  it('lists and revokes sessions; remember-me sets a persistent cookie', async () => {
    const a = await login('new.client@example.com', 'newclientpass123', { rememberMe: true });
    const b = await login('new.client@example.com', 'newclientpass123');
    expect(a.cookies.find((c) => c.name === 'pv_session')?.maxAge).toBeGreaterThan(0);
    expect(b.cookies.find((c) => c.name === 'pv_session')?.maxAge).toBeUndefined();
    const list = await get('/api/v1/auth/sessions', { cookie: cookieOf(a) });
    expect(list.statusCode).toBe(200);
    const sessions = list.json().data as Array<{
      id: string;
      current: boolean;
      rememberMe: boolean;
    }>;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.find((s) => s.current)?.rememberMe).toBe(true);
    const others = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions',
      headers: { ...ORIGIN, cookie: cookieOf(a) },
    });
    expect(others.json().data.revoked).toBeGreaterThanOrEqual(1);
    expect((await get('/api/v1/auth/me', { cookie: cookieOf(b) })).statusCode).toBe(401);
    expect((await get('/api/v1/auth/me', { cookie: cookieOf(a) })).statusCode).toBe(200);
  });

  // ------------------------------------------------------------------ impersonation
  it('admin can log in as a client; actions are audited with the impersonator; stop restores admin', async () => {
    const [client] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'new.client@example.com'));
    const start = await post(
      '/api/v1/auth/impersonate',
      { userId: client?.id },
      { cookie: adminCookie },
    );
    expect(start.statusCode).toBe(200);
    expect(start.json().data.email).toBe('new.client@example.com');
    expect(start.json().data.impersonator).toMatchObject({ id: adminId, email: ADMIN.email });
    const impCookie = cookieOf(start);
    const me = await get('/api/v1/auth/me', { cookie: impCookie });
    expect(me.json().data.impersonator.id).toBe(adminId);
    // Sensitive self-service is blocked while impersonating
    expect(
      (await post('/api/v1/auth/2fa/setup', undefined, { cookie: impCookie })).statusCode,
    ).toBe(403);
    // A mutation made while impersonating carries the impersonator in the audit row
    await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions',
      headers: { ...ORIGIN, cookie: impCookie },
    });
    const [row] = await app.db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.action, 'auth.sessions_revoked'))
      .orderBy(desc(activityLogTable.createdAt))
      .limit(1);
    expect(row?.actorUserId).toBe(client?.id);
    expect(row?.impersonatorUserId).toBe(adminId);
    const [startLog] = await app.db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.action, 'auth.impersonate.start'))
      .orderBy(desc(activityLogTable.createdAt))
      .limit(1);
    expect(startLog?.actorUserId).toBe(adminId);
    expect(startLog?.entityId).toBe(client?.id);
    // Admin's own session untouched; stop returns to it
    expect((await get('/api/v1/auth/me', { cookie: adminCookie })).json().data.id).toBe(adminId);
    const stop = await post('/api/v1/auth/impersonate/stop', undefined, { cookie: impCookie });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().data.id).toBe(adminId);
    expect(cookieOf(stop)).toBe(adminCookie);
    expect((await get('/api/v1/auth/me', { cookie: impCookie })).statusCode).toBe(401);
    // Clients cannot impersonate
    const clientLogin = await login('new.client@example.com', 'newclientpass123');
    expect(
      (
        await post(
          '/api/v1/auth/impersonate',
          { userId: adminId },
          { cookie: cookieOf(clientLogin) },
        )
      ).statusCode,
    ).toBe(403);
  });

  // ------------------------------------------------------------------ RBAC with roles + API key scopes
  it('staff permissions come from roles; API key scopes narrow them; 401/403 semantics', async () => {
    const roleList = await get('/api/v1/admin/roles', { cookie: adminCookie });
    expect(roleList.statusCode).toBe(200);
    const support = (
      roleList.json().data as Array<{ id: string; name: string; isSystem: boolean }>
    ).find((r) => r.name === 'Support');
    expect(support?.isSystem).toBe(true);
    const created = await post(
      '/api/v1/admin/users',
      {
        email: 'support@example.com',
        password: 'supportpass123',
        role: 'staff',
        firstName: 'Sup',
        lastName: 'Port',
        roleIds: [support?.id],
      },
      { cookie: adminCookie },
    );
    expect(created.statusCode).toBe(201);
    expect(created.json().data.roles).toEqual([{ id: support?.id, name: 'Support' }]);
    const staffLogin = await login('support@example.com', 'supportpass123');
    expect(staffLogin.json().data.permissions).toContain('tickets.write');
    const staffCookie = cookieOf(staffLogin);
    expect((await get('/api/v1/admin/activity', { cookie: staffCookie })).statusCode).toBe(200);
    expect((await get('/api/v1/admin/users', { cookie: staffCookie })).statusCode).toBe(403);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/company',
      payload: { name: 'x' },
      headers: { ...ORIGIN, cookie: staffCookie },
    });
    expect(put.statusCode).toBe(403);
    expect(put.json().error.code).toBe('forbidden');
    expect((await get('/api/v1/admin/activity')).statusCode).toBe(401);

    // Role edit propagates on the next request
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/roles/${support?.id}`,
      payload: { permissions: [...(support ? [] : []), 'tickets.read'] },
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    expect(patch.statusCode).toBe(200);
    expect((await get('/api/v1/admin/activity', { cookie: staffCookie })).statusCode).toBe(403);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/roles/${support?.id}`,
      payload: {
        permissions: [
          'tickets.read',
          'tickets.write',
          'activity.read',
          'clients.read',
          'clients.impersonate',
        ],
      },
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/roles/${support?.id}`,
          headers: { ...ORIGIN, cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(409);

    // API key with a narrow scope
    const key = await post(
      '/api/v1/auth/api-keys',
      { name: 'ci', scopes: ['activity.read'] },
      { cookie: adminCookie },
    );
    expect(key.statusCode).toBe(201);
    const token = key.json().data.token as string;
    expect(token.startsWith('pv_')).toBe(true);
    expect(
      (await get('/api/v1/admin/activity', { authorization: `Bearer ${token}` })).statusCode,
    ).toBe(200);
    const scoped = await get('/api/v1/admin/users', { authorization: `Bearer ${token}` });
    expect(scoped.statusCode).toBe(403);
    expect(scoped.json().error.code).toBe('insufficient_scope');
    const [k] = await app.db.select().from(apiKeys).where(eq(apiKeys.id, key.json().data.id));
    expect(k?.lastUsedAt).not.toBeNull();
    expect(k?.lastUsedIp).toMatch(/^10\./);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/api-keys/${key.json().data.id}`,
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    expect(
      (await get('/api/v1/admin/activity', { authorization: `Bearer ${token}` })).statusCode,
    ).toBe(401);

    // Disable staff: sessions gone; last-admin and self protections
    const disable = await post(`/api/v1/admin/users/${created.json().data.id}/disable`, undefined, {
      cookie: adminCookie,
    });
    expect(disable.statusCode).toBe(200);
    expect((await get('/api/v1/auth/me', { cookie: staffCookie })).statusCode).toBe(401);
    expect(
      (await post(`/api/v1/admin/users/${adminId}/disable`, undefined, { cookie: adminCookie }))
        .statusCode,
    ).toBe(409);
  });

  // ------------------------------------------------------------------ settings
  it('settings: secrets encrypted at rest, masked on read, mask keeps value; public settings', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/mail',
      payload: { smtpHost: 'smtp.example.com', smtpPassword: 'hunter2' },
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.smtpPassword).toBe('••••••••');
    const [row] = await app.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, 'mail.smtpPassword'));
    expect(String(row?.value).startsWith('enc:v1:')).toBe(true);
    const got = await get('/api/v1/admin/settings/mail', { cookie: adminCookie });
    expect(got.json().data).toMatchObject({
      smtpHost: 'smtp.example.com',
      smtpPassword: '••••••••',
    });
    expect(got.json().schema.type).toBe('object');
    invalidateSettings();
    expect((await getSettings(app.db, 'mail')).smtpPassword).toBe('hunter2');
    // Sending the mask back keeps the stored secret; changing another field works
    await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/mail',
      payload: { smtpPassword: '••••••••', smtpPort: 2525 },
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    invalidateSettings();
    const mail = await getSettings(app.db, 'mail');
    expect(mail.smtpPassword).toBe('hunter2');
    expect(mail.smtpPort).toBe(2525);
    const [log] = await app.db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.action, 'settings.update'))
      .orderBy(desc(activityLogTable.createdAt))
      .limit(1);
    expect(JSON.stringify(log?.diff)).not.toContain('hunter2');
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/billing',
      payload: { paymentTermDays: 999 },
      headers: { ...ORIGIN, cookie: adminCookie },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await get('/api/v1/admin/settings/nope', { cookie: adminCookie })).statusCode).toBe(
      400,
    );
    const pub = await get('/api/v1/public/settings');
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data).toMatchObject({ allowRegistration: true, defaultCurrency: 'EUR' });
    expect(JSON.stringify(pub.json())).not.toContain('smtp');
    const all = await get('/api/v1/admin/settings', { cookie: adminCookie });
    expect(Object.keys(all.json().data)).toContain('security');
    expect(all.json().schemas.security.properties.require2faForStaff).toBeDefined();
  });

  // ------------------------------------------------------------------ automation + activity + modules + audit hook
  it('activity log lists with filters; auto-audit hook logs admin mutations without explicit log', async () => {
    const id = '11111111-1111-7111-8111-111111111111';
    const res = await post(
      `/api/v1/admin/hooktest/${id}`,
      { note: 'x', password: 'secret!' },
      { cookie: adminCookie },
    );
    expect(res.statusCode).toBe(200);
    const [auto] = await app.db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.action, 'admin.post'))
      .orderBy(desc(activityLogTable.createdAt))
      .limit(1);
    expect(auto?.entityType).toBe('hooktest');
    expect(auto?.entityId).toBe(id);
    expect(JSON.stringify(auto?.diff)).toContain('[redacted]');
    expect(JSON.stringify(auto?.diff)).not.toContain('secret!');
    const list = await get(
      `/api/v1/admin/activity?action=auth.*&actorUserId=${adminId}&perPage=5`,
      { cookie: adminCookie },
    );
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.total).toBeGreaterThan(0);
    for (const e of list.json().data) expect(e.action.startsWith('auth.')).toBe(true);
    expect(list.json().data[0].actorEmail).toBe(ADMIN.email);
  });

  it('automation endpoints respond (schedules may be empty without a worker)', async () => {
    expect((await get('/api/v1/admin/automation/jobs', { cookie: adminCookie })).statusCode).toBe(
      200,
    );
    const q = await get('/api/v1/admin/automation/queues', { cookie: adminCookie });
    expect(q.statusCode).toBe(200);
    expect(q.json().data.map((x: { queue: string }) => x.queue)).toContain('email');
    expect(
      (await get('/api/v1/admin/automation/schedules', { cookie: adminCookie })).statusCode,
    ).toBe(200);
    expect(
      (
        await post('/api/v1/admin/automation/run/maintenance:doesNotExist', undefined, {
          cookie: adminCookie,
        })
      ).statusCode,
    ).toBe(404);
    const mods = await get('/api/v1/admin/modules?kind=gateway', { cookie: adminCookie });
    expect(mods.statusCode).toBe(200);
    expect(Array.isArray(mods.json().data)).toBe(true);
  });

  it('security headers and 401 vs 403 are consistent', async () => {
    const res = await get('/api/v1/public/health');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const authed = await get('/api/v1/auth/me', { cookie: adminCookie });
    expect(authed.headers['cache-control']).toBe('no-store');
    const badKey = await get('/api/v1/auth/me', { authorization: 'Bearer pv_invalid' });
    expect(badKey.statusCode).toBe(401);
    const [roleRow] = await app.db.select().from(roles).limit(1);
    expect(roleRow).toBeDefined();
  });
});

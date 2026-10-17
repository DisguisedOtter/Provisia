import { createDb, users } from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { seed } from '@provisia/db/seed';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createApiKey } from './lib/api-key.js';

const TEST_URL = process.env.DATABASE_URL_TEST;
const ADMIN = { email: 'it-admin@example.com', password: 'integration-pass-1' };

describe.skipIf(!TEST_URL)('api integration', () => {
  let app: FastifyInstance;
  let cookie = '';

  beforeAll(async () => {
    const url = TEST_URL as string;
    await runMigrations(url);
    const { db, close } = createDb(url, { max: 1 });
    await seed(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    await close();
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        APP_KEY: '11'.repeat(32),
        SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ checks: { database: 'ok' }, version: expect.any(String) });
  });

  it('serves openapi', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/api/v1/auth/login']).toBeDefined();
  });

  it('returns the error envelope for validation errors and unknown routes', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: { code: 'validation_error', details: expect.any(Array) },
    });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');
  });

  it('rejects bad credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('logs in, reads /me, logs out', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data).toMatchObject({ email: ADMIN.email, role: 'admin', clientId: null });
    expect(login.json().data.passwordHash).toBeUndefined();
    const setCookie = login.cookies.find((c) => c.name === 'pv_session');
    expect(setCookie?.httpOnly).toBe(true);
    cookie = `pv_session=${setCookie?.value}`;

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(ADMIN.email);

    const csrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(csrf.statusCode).toBe(403);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'http://localhost:3000' },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('authenticates with an API key', async () => {
    const [admin] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN.email));
    if (!admin) throw new Error('seeded admin missing');
    const key = await createApiKey(app.db, { userId: admin.id, name: 'test' });
    expect(key.token.startsWith('pv_')).toBe(true);

    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.id).toBe(admin.id);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer pv_nope' },
    });
    expect(bad.statusCode).toBe(401);
  });
});

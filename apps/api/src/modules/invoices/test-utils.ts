/**
 * Shared harness for billing-area route tests (clients, products, orders, services, invoices).
 *
 * Run against your own database (TEAM-RULES item 4):
 *   DATABASE_URL_TEST=postgres://provisia:provisia@localhost:5432/provisia_billing SKIP_MIGRATIONS=1 \
 *     pnpm --filter @provisia/api test
 * `SKIP_MIGRATIONS=1` because the schema was applied with `drizzle-kit push` (no generated migration yet).
 */
import { clients, createDb, type Db, sessions, users } from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { seed } from '@provisia/db/seed';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { hashPassword } from '../../lib/password.js';

export const TEST_URL = process.env.DATABASE_URL_TEST;
export const ORIGIN = 'http://localhost:3000';

export interface BillingTestApp {
  app: FastifyInstance;
  db: Db;
  adminCookie: string;
  /** Headers for a cookie-authenticated mutation (session + same-origin for CSRF). */
  adminHeaders: Record<string, string>;
  /** Logs in through the HTTP route (rate limited: 10/min); prefer `sessionFor` in loops. */
  login(email: string, password: string): Promise<string>;
  /** Mints a session cookie directly in the DB (no rate limit). */
  sessionFor(userId: string): Promise<string>;
  headersFor(cookie: string): Record<string, string>;
  createClient(
    over?: Partial<typeof clients.$inferInsert> & {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<{
    client: typeof clients.$inferSelect;
    user: { id: string; email: string };
    password: string;
    cookie: string;
    headers: Record<string, string>;
  }>;
  /** Truncates billing tables (keeps seed data: admin, settings, tax rules, catalog). */
  resetBilling(): Promise<void>;
  close(): Promise<void>;
}

let counter = 0;

export async function setupBillingTestApp(
  opts: { adminEmail?: string; register?: FastifyPluginAsyncZod[] } = {},
): Promise<BillingTestApp> {
  const url = TEST_URL;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  const admin = {
    email: opts.adminEmail ?? 'billing-admin@example.com',
    password: 'billing-admin-pass-1',
  };
  if (!process.env.SKIP_MIGRATIONS) await runMigrations(url);
  const seedConn = createDb(url, { max: 1 });
  await seed(seedConn.db, { adminEmail: admin.email, adminPassword: admin.password });
  await seedConn.close();

  const app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      APP_KEY: '11'.repeat(32),
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
      WEB_URL: ORIGIN,
    }),
    logger: false,
  });
  if (opts.register?.length) {
    await app.register(
      async (v1) => {
        for (const r of opts.register ?? []) await v1.register(r);
      },
      { prefix: '/api/v1' },
    );
  }
  await app.ready();
  const db = app.db;

  const headersFor = (cookie: string) => ({ cookie, origin: ORIGIN });
  const login = async (email: string, password: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    if (res.statusCode !== 200)
      throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
    const c = res.cookies.find((x) => x.name === 'pv_session');
    if (!c) throw new Error('no session cookie');
    return `pv_session=${c.value}`;
  };
  const sessionFor = async (userId: string) => {
    const [row] = await db
      .insert(sessions)
      .values({
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ip: '127.0.0.1',
        userAgent: 'vitest',
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error('session insert failed');
    return `pv_session=${app.signCookie(row.id)}`;
  };
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, admin.email));
  if (!adminUser) throw new Error('seeded admin missing');
  const adminCookie = await sessionFor(adminUser.id);

  return {
    app,
    db,
    adminCookie,
    adminHeaders: headersFor(adminCookie),
    login,
    sessionFor,
    headersFor,
    async createClient(over = {}) {
      counter += 1;
      const email = (over.email ?? `client-${Date.now()}-${counter}@example.com`).toLowerCase();
      const password = over.password ?? 'client-pass-12345';
      const { email: _e, password: _p, firstName, lastName, ...clientOver } = over;
      const [u] = await db
        .insert(users)
        .values({
          email,
          passwordHash: await hashPassword(password),
          role: 'client',
          firstName: firstName ?? 'Test',
          lastName: lastName ?? `Client${counter}`,
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id, email: users.email });
      if (!u) throw new Error('user insert failed');
      const [client] = await db
        .insert(clients)
        .values({
          userId: u.id,
          country: 'NL',
          address1: 'Teststraat 1',
          city: 'Amsterdam',
          postalCode: '1000 AA',
          language: 'nl',
          ...clientOver,
        })
        .returning();
      if (!client) throw new Error('client insert failed');
      const cookie = await sessionFor(u.id);
      return { client, user: u, password, cookie, headers: headersFor(cookie) };
    },
    async resetBilling() {
      await db.execute(
        sql`truncate table invoice_items, invoices, transactions, credit_notes, invoice_counters, orders, order_items, services, domains restart identity cascade`,
      );
      await db
        .delete(clients)
        .where(sql`${clients.userId} in (select id from ${users} where ${users.role} = 'client')`);
      await db.delete(users).where(eq(users.role, 'client'));
    },
    async close() {
      await app.close();
    },
  };
}

import {
  clients,
  createDb,
  domainAlerts,
  domainContacts,
  domainSyncLog,
  domains,
  registrarAccounts,
  tlds,
  users,
} from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { seed } from '@provisia/db/seed';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { hashPassword } from '../../lib/password.js';
import { createDomainOrderItem } from './order-item.js';

// Registrar calls never run inline (except availability); enqueue() is mocked so no Redis is needed.
const enqueued: Array<{ queue: string; name: string; data: unknown; opts?: unknown }> = [];
vi.mock('@provisia/worker/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@provisia/worker/queues')>()),
  enqueue: async (queue: string, name: string, data: unknown, opts?: unknown) => {
    enqueued.push({ queue, name, data, opts });
    return { id: (opts as { jobId?: string } | undefined)?.jobId ?? 'job-1' };
  },
}));

const TEST_URL = process.env.DATABASE_URL_TEST;
const ADMIN = { email: 'domains-admin@example.com', password: 'integration-pass-1' };
const CLIENT = { email: 'domains-client@example.com', password: 'integration-pass-2' };
const APP_KEY = '22'.repeat(32);

describe.skipIf(!TEST_URL)('domains module', () => {
  let app: FastifyInstance;
  let admin = '';
  let client = '';
  let clientId = '';
  let tldId = '';
  let domainId = '';
  const contact = {
    firstName: 'Jan',
    lastName: 'Jansen',
    email: 'jan@example.nl',
    phone: '+31.612345678',
    address1: 'Dam 1',
    city: 'Amsterdam',
    postalCode: '1012JS',
    country: 'NL',
  };

  async function login(email: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    return res.cookies.find((c) => c.name === 'pv_session')?.value as string;
  }
  const asAdmin = (opts: InjectOptions) => app.inject({ ...opts, cookies: { pv_session: admin } });
  const asClient = (opts: InjectOptions) =>
    app.inject({ ...opts, cookies: { pv_session: client } });

  beforeAll(async () => {
    const url = TEST_URL as string;
    // Until the wave migration exists the test DB is prepared with `drizzle-kit push` (README);
    // on such a DB the migrator fails on the first statement, which is fine.
    await runMigrations(url).catch(() => {});
    const { db, close } = createDb(url, { max: 1 });
    await seed(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    // Clean slate for our tables and a client user.
    await db.delete(domainAlerts);
    await db.delete(domainSyncLog);
    await db.delete(domains);
    await db.delete(domainContacts);
    await db.delete(tlds);
    await db.delete(registrarAccounts);
    const [existing] = await db.select().from(users).where(eq(users.email, CLIENT.email));
    let userId = existing?.id;
    if (!userId) {
      const [u] = await db
        .insert(users)
        .values({
          email: CLIENT.email,
          passwordHash: await hashPassword(CLIENT.password),
          role: 'client',
          firstName: 'Jan',
          lastName: 'Jansen',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      userId = u?.id;
    }
    if (!userId) throw new Error('no client user');
    const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
    clientId =
      c?.id ??
      (await db.insert(clients).values({ userId, country: 'NL' }).returning({ id: clients.id }))[0]
        ?.id ??
      '';
    await close();

    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        APP_KEY,
        SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
      }),
      logger: false,
    });
    await app.ready();
    admin = await login(ADMIN.email, ADMIN.password);
    client = await login(CLIENT.email, CLIENT.password);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists registrar modules and configures skrime with an encrypted, masked config', async () => {
    const list = await asAdmin({ method: 'GET', url: '/api/v1/admin/registrars' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toContainEqual(
      expect.objectContaining({
        id: 'skrime',
        configured: false,
        capabilities: { contacts: true, lock: false, pricing: true },
      }),
    );

    const bad = await asAdmin({
      method: 'PUT',
      url: '/api/v1/admin/registrars/skrime',
      payload: { config: { sandbox: true } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_error');

    const ok = await asAdmin({
      method: 'PUT',
      url: '/api/v1/admin/registrars/skrime',
      payload: {
        config: { apiKey: 'secret-key-1234', sandbox: true, baseUrl: 'https://skrime.test/api' },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.config.apiKey).toBe('***1234');

    // Sending the masked value back keeps the stored secret.
    const again = await asAdmin({
      method: 'PUT',
      url: '/api/v1/admin/registrars/skrime',
      payload: {
        config: { apiKey: '***1234', sandbox: false, baseUrl: 'https://skrime.test/api' },
      },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.config).toMatchObject({ apiKey: '***1234', sandbox: false });
    const missing = await asAdmin({ method: 'GET', url: '/api/v1/admin/registrars/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('creates a TLD with prices and exposes it publicly', async () => {
    const res = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/tlds',
      payload: {
        tld: '.nl',
        registrarModule: 'skrime',
        featured: true,
        prices: [{ years: 1, register: 990, renew: 1090, transfer: 990 }],
      },
    });
    expect(res.statusCode).toBe(201);
    tldId = res.json().data.id;
    expect(res.json().data).toMatchObject({
      tld: 'nl',
      prices: [expect.objectContaining({ years: 1, register: 990 })],
    });

    const dupe = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/tlds',
      payload: { tld: 'nl' },
    });
    expect(dupe.statusCode).toBe(409);

    const manual = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/tlds',
      payload: { tld: 'test', prices: [{ register: 500, renew: 500, transfer: 500 }] },
    });
    expect(manual.statusCode).toBe(201);

    const pub = await app.inject({ method: 'GET', url: '/api/v1/public/tlds' });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.map((t: { tld: string }) => t.tld)).toEqual(['nl', 'test']);

    const patched = await asAdmin({
      method: 'PATCH',
      url: `/api/v1/admin/tlds/${tldId}`,
      payload: {
        prices: [
          { years: 1, register: 1000, renew: 1100, transfer: 1000 },
          { years: 2, register: 1900, renew: 2100, transfer: 1900 },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.prices).toHaveLength(2);
  });

  it('enqueues a pricing import instead of calling the registrar inline', async () => {
    const res = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/tlds/import-pricing',
      payload: { registrarModule: 'skrime', markupPercent: 30 },
    });
    expect(res.statusCode).toBe(202);
    expect(enqueued.at(-1)).toMatchObject({
      queue: 'domains',
      name: 'importPricing',
      data: { registrarModule: 'skrime', markupPercent: 30 },
    });
  });

  it('answers availability from local knowledge without a registrar call for unknown/no-registrar TLDs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/domains/availability?sld=example&tlds=test,xyz',
    });
    expect(res.statusCode).toBe(200);
    const { requested, suggestions, ttl } = res.json().data;
    expect(requested).toBeNull();
    expect(ttl).toBeGreaterThan(0);
    expect(suggestions).toEqual([
      expect.objectContaining({
        domain: 'example.test',
        status: 'unknown',
        reason: 'no_registrar',
        price: { amount: 500, currency: 'EUR', years: 1 },
      }),
      expect.objectContaining({
        domain: 'example.xyz',
        status: 'unknown',
        reason: 'tld_not_offered',
      }),
    ]);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/public/domains/availability' });
    expect(bad.statusCode).toBe(400);
  });

  it('prices a domain order item', async () => {
    const line = await createDomainOrderItem(app.db, {
      type: 'domain_register',
      domain: 'shop.nl',
      years: 2,
      contacts: { registrant: contact },
    });
    expect(line).toMatchObject({
      domainName: 'shop.nl',
      tld: 'nl',
      registrarModule: 'skrime',
      quantity: 2,
      billingCycle: 'biennially',
      amount: 1900,
      renewAmountPerYear: 1100,
    });
    await expect(
      createDomainOrderItem(app.db, { type: 'domain_register', domain: 'shop.xyz' }),
    ).rejects.toMatchObject({ code: 'tld_not_offered' });
    await expect(
      createDomainOrderItem(app.db, { type: 'domain_transfer', domain: 'shop.nl' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    const three = await createDomainOrderItem(app.db, {
      type: 'domain_register',
      domain: 'shop.nl',
      years: 3,
    });
    expect(three.amount).toBe(3000); // 1-year row x 3
  });

  it('registers a domain for a client (pending + register job) and lists it in the portal', async () => {
    const noContact = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/domains/register',
      payload: { clientId, domain: 'example.nl' },
    });
    expect(noContact.statusCode).toBe(400);
    expect(noContact.json().error.code).toBe('domain_contact_required');

    const handle = await asClient({
      method: 'POST',
      url: '/api/v1/portal/domain-contacts',
      payload: { ...contact, isDefault: true },
    });
    expect(handle.statusCode).toBe(201);

    const res = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/domains/register',
      payload: { clientId, domain: 'Example.NL', years: 1 },
    });
    expect(res.statusCode).toBe(202);
    domainId = res.json().data.id;
    expect(res.json().data).toMatchObject({
      name: 'example.nl',
      tld: 'nl',
      status: 'pending',
      registrarModule: 'skrime',
      recurringAmount: 1100,
      contacts: { registrant: expect.objectContaining({ lastName: 'Jansen' }) },
    });
    expect(res.json().job).toMatchObject({
      queue: 'domains',
      name: 'register',
      id: `domain:${domainId}:register`,
    });

    const dupe = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/domains/register',
      payload: { clientId, domain: 'example.nl' },
    });
    expect(dupe.statusCode).toBe(409);

    const portal = await asClient({ method: 'GET', url: '/api/v1/portal/domains' });
    expect(portal.statusCode).toBe(200);
    expect(portal.json().data).toHaveLength(1);
    expect(portal.json().data[0]).not.toHaveProperty('moduleData');

    const taken = await app.inject({
      method: 'GET',
      url: '/api/v1/public/domains/availability?domain=example.nl&suggestions=false',
    });
    expect(taken.json().data.requested).toMatchObject({ status: 'taken', reason: 'managed_here' });
  });

  it('enforces the state machine and portal boundaries', async () => {
    const bad = await asAdmin({
      method: 'POST',
      url: `/api/v1/admin/domains/${domainId}/status`,
      payload: { status: 'redemption' },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('invalid_status_transition');

    const renewPending = await asClient({
      method: 'POST',
      url: `/api/v1/portal/domains/${domainId}/renew`,
      payload: { years: 1 },
    });
    expect(renewPending.statusCode).toBe(409);

    const activate = await asAdmin({
      method: 'POST',
      url: `/api/v1/admin/domains/${domainId}/status`,
      payload: { status: 'active', reason: 'test' },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().data.status).toBe('active');

    // Lock change on Skrime (no setLock) is rejected; nameserver change is pushed via sync job.
    const lock = await asClient({
      method: 'PATCH',
      url: `/api/v1/portal/domains/${domainId}`,
      payload: { locked: false },
    });
    expect(lock.statusCode).toBe(409);
    expect(lock.json().error.code).toBe('registrar_unsupported');

    const ns = await asClient({
      method: 'PATCH',
      url: `/api/v1/portal/domains/${domainId}`,
      payload: { nameservers: ['ns1.example.net', 'ns2.example.net'], autoRenew: false },
    });
    expect(ns.statusCode).toBe(200);
    expect(ns.json().data).toMatchObject({
      nameservers: ['ns1.example.net', 'ns2.example.net'],
      autoRenew: false,
    });
    expect(ns.json().job).toMatchObject({ name: 'sync' });
    expect(enqueued.at(-1)).toMatchObject({
      name: 'sync',
      data: { domainId, push: ['nameservers'] },
    });

    const renew = await asClient({
      method: 'POST',
      url: `/api/v1/portal/domains/${domainId}/renew`,
      payload: { years: 1 },
    });
    expect(renew.statusCode).toBe(202);
    expect(enqueued.at(-1)).toMatchObject({ name: 'renew', data: { domainId, years: 1 } });

    const epp = await asClient({
      method: 'POST',
      url: `/api/v1/portal/domains/${domainId}/epp-code`,
    });
    expect(epp.statusCode).toBe(200);
    expect(epp.json().data).toMatchObject({ eppCode: null, job: { id: expect.any(String) } });
    expect(enqueued.at(-1)).toMatchObject({ name: 'fetchEppCode' });

    const sync = await asAdmin({ method: 'POST', url: `/api/v1/admin/domains/${domainId}/sync` });
    expect(sync.statusCode).toBe(202);

    const other = await asClient({ method: 'GET', url: `/api/v1/admin/domains/${domainId}` });
    expect(other.statusCode).toBe(403);

    const log = await asAdmin({ method: 'GET', url: `/api/v1/admin/domains/${domainId}/sync-log` });
    expect(log.statusCode).toBe(200);
    expect(log.json().data[0]).toMatchObject({ job: 'manual', transition: 'pending -> active' });
  });

  it('starts a transfer with the EPP code stored encrypted', async () => {
    const res = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/domains/transfer',
      payload: {
        clientId,
        domain: 'moved.nl',
        eppCode: 'EPP-123',
        contacts: { registrant: contact },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).not.toHaveProperty('eppCodeEncrypted');
    const [row] = await app.db
      .select({ epp: domains.eppCodeEncrypted })
      .from(domains)
      .where(eq(domains.id, res.json().data.id));
    expect(row?.epp).toMatch(/^enc:v1:/);
    expect(enqueued.at(-1)).toMatchObject({ name: 'transfer' });
    const noEpp = await asAdmin({
      method: 'POST',
      url: '/api/v1/admin/domains/transfer',
      payload: { clientId, domain: 'moved2.nl', contacts: { registrant: contact } },
    });
    expect(noEpp.statusCode).toBe(400);
  });

  it('lists and acknowledges alerts', async () => {
    await app.db
      .insert(domainAlerts)
      .values({ domainId, severity: 'error', kind: 'register_failed', title: 't', message: 'm' });
    const list = await asAdmin({ method: 'GET', url: '/api/v1/admin/domain-alerts' });
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.total).toBe(1);
    const ack = await asAdmin({
      method: 'POST',
      url: `/api/v1/admin/domain-alerts/${list.json().data[0].id}/acknowledge`,
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().data.acknowledgedAt).toBeTruthy();
    const after = await asAdmin({ method: 'GET', url: '/api/v1/admin/domain-alerts' });
    expect(after.json().meta.total).toBe(0);
  });

  it('documents every route in OpenAPI', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const paths = Object.keys(res.json().paths);
    for (const p of [
      '/api/v1/public/domains/availability',
      '/api/v1/admin/tlds',
      '/api/v1/admin/domains/register',
      '/api/v1/portal/domains/{id}/epp-code',
      '/api/v1/admin/registrars/{module}',
    ]) {
      expect(paths).toContain(p);
    }
  });
});

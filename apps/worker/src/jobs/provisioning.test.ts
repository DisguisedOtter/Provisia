import { randomBytes } from 'node:crypto';
import {
  clients,
  createDb,
  type Db,
  productGroups,
  products,
  provisioningLog,
  serverGroups,
  servers,
  services,
  serviceUsage,
  users,
} from '@provisia/db';
import { decrypt, defineProvisioner, encryptJson } from '@provisia/module-sdk';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { JobContext } from '../context.js';

vi.mock('../queues.js', () => ({
  enqueue: vi.fn(async (_q: string, name: string, data: unknown) => ({
    id: `${name}:${JSON.stringify(data)}`,
  })),
  getQueue: vi.fn(() => ({ add: vi.fn() })),
}));

import { enqueue } from '../queues.js';
import {
  activateOrder,
  buildModuleContext,
  create,
  isFinalAttempt,
  provisionerRegistry,
  suspend,
  syncUsage,
  terminate,
  testConnection,
  toServerDto,
} from './provisioning.js';

process.env.APP_KEY ??= randomBytes(32).toString('hex');
const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return silent;
  },
} as unknown as JobContext['logger'];

/** Fake module registered next to the real ones; behaviour is scripted per test. */
const calls: string[] = [];
let failWith: Error | null = null;
const fake = defineProvisioner({
  id: 'fakepanel',
  name: 'Fake panel',
  version: '0.0.1',
  configSchema: z.object({ plan: z.string() }),
  credentialsSchema: z.object({ token: z.string().min(3) }),
  async create(ctx, svc) {
    calls.push(`create:${ctx.config.plan}:${svc.server?.name}`);
    if (failWith) throw failWith;
    return {
      moduleData: { acct: 'u1' },
      username: 'u1',
      password: 'Generated-Pass-1',
      ipAddress: '10.0.0.1',
    };
  },
  async suspend(_ctx, _svc, reason) {
    calls.push(`suspend:${reason}`);
    if (failWith) throw failWith;
  },
  async unsuspend() {
    calls.push('unsuspend');
  },
  async terminate() {
    calls.push('terminate');
  },
  async getUsage() {
    return { diskUsedMb: 12, diskLimitMb: 100, extra: { status: 'running' } };
  },
  async testConnection(ctx) {
    return ctx.credentials.token === 'good-token'
      ? { ok: true, message: 'fine' }
      : { ok: false, message: 'bad token' };
  },
});

describe('provisioning job helpers', () => {
  it('knows the installed modules', () => {
    const ids = provisionerRegistry()
      .list('provisioner')
      .map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['cpanel', 'plesk', 'directadmin', 'proxmox']));
  });

  it('detects the final attempt', () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
    expect(isFinalAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(true);
    expect(isFinalAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 3 } }, true)).toBe(true);
  });

  it('strips secrets and status columns from the server DTO', () => {
    const dto = toServerDto({
      id: 'x',
      name: 's',
      module: 'cpanel',
      hostname: 'h',
      ipAddress: null,
      port: null,
      secure: true,
      credentialsEncrypted: 'enc:v1:zzz',
      nameservers: [],
      groupName: null,
      maxAccounts: 0,
      active: true,
      notes: null,
      statusCheckedAt: null,
      statusOk: null,
      statusMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(dto).not.toHaveProperty('credentialsEncrypted');
    expect(dto).not.toHaveProperty('statusOk');
    expect(dto.hostname).toBe('h');
  });

  it('builds a module context with decrypted credentials and parsed config', () => {
    const server = {
      credentialsEncrypted: encryptJson({ token: 'abc' }),
      name: 'srv',
    } as typeof servers.$inferSelect;
    const ctx = buildModuleContext({ logger: silent, appUrl: 'a', webUrl: 'w' }, fake, server, {
      plan: 'gold',
    });
    expect(ctx.credentials).toEqual({ token: 'abc' });
    expect(ctx.config).toEqual({ plan: 'gold' });
    expect(() =>
      buildModuleContext({ logger: silent, appUrl: 'a', webUrl: 'w' }, fake, server, {}),
    ).toThrow();
    const broken = { ...server, credentialsEncrypted: 'enc:v1:AAAA' };
    expect(() =>
      buildModuleContext({ logger: silent, appUrl: 'a', webUrl: 'w' }, fake, broken, { plan: 'x' }),
    ).toThrow(/decrypt/);
  });
});

/**
 * Integration: needs a database with the full schema pushed (`drizzle-kit push`), e.g.
 *   createdb provisia_provisioning && DATABASE_URL=…/provisia_provisioning pnpm --filter @provisia/db exec drizzle-kit push
 *   DATABASE_URL_PROVISIONING_TEST=postgres://provisia:provisia@localhost:5432/provisia_provisioning pnpm --filter @provisia/worker test
 */
const TEST_URL = process.env.DATABASE_URL_PROVISIONING_TEST;

describe.skipIf(!TEST_URL)('provisioning jobs (db)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let ctx: JobContext;
  const ids = { client: '', product: '', product2: '', srvA: '', srvB: '', service: '' };
  const job = (attemptsMade = 0, attempts = 3) =>
    ({ attemptsMade, opts: { attempts }, id: 'j1' }) as unknown as never;

  beforeAll(async () => {
    const c = createDb(TEST_URL as string, { max: 2 });
    db = c.db;
    close = c.close;
    ctx = {
      db,
      redis: {} as JobContext['redis'],
      logger: silent,
      appUrl: 'http://api.test',
      webUrl: 'http://web.test',
    };
    if (!provisionerRegistry().has('provisioner', 'fakepanel'))
      provisionerRegistry().register('provisioner', fake);

    await db.delete(serviceUsage);
    await db.delete(provisioningLog);
    await db.delete(services);
    await db.delete(servers);
    await db.delete(serverGroups);
    const email = `prov-${Date.now()}@example.test`;
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: 'x', role: 'client', firstName: 'Jane', lastName: 'Doe' })
      .returning();
    const [client] = await db
      .insert(clients)
      .values({ userId: (user as { id: string }).id, country: 'NL' })
      .returning();
    ids.client = (client as { id: string }).id;
    const [group] = await db
      .insert(productGroups)
      .values({ name: `g${Date.now()}`, slug: `g${Date.now()}` })
      .returning();
    const gid = (group as { id: string }).id;
    const [p1] = await db
      .insert(products)
      .values({
        groupId: gid,
        name: 'Fake Gold',
        slug: `gold-${Date.now()}`,
        module: 'fakepanel',
        moduleConfig: { plan: 'gold' },
        serverGroup: 'fake-pool',
      })
      .returning();
    const [p2] = await db
      .insert(products)
      .values({
        groupId: gid,
        name: 'Fake Silver',
        slug: `silver-${Date.now()}`,
        module: 'fakepanel',
        moduleConfig: { plan: 'silver' },
        serverGroup: 'fake-pool',
      })
      .returning();
    ids.product = (p1 as { id: string }).id;
    ids.product2 = (p2 as { id: string }).id;
    await db.insert(serverGroups).values({ name: 'fake-pool', fillType: 'least_loaded' });
    const creds = encryptJson({ token: 'good-token' });
    const [a] = await db
      .insert(servers)
      .values({
        name: 'alpha',
        module: 'fakepanel',
        hostname: 'a.test',
        credentialsEncrypted: creds,
        groupName: 'fake-pool',
        maxAccounts: 10,
      })
      .returning();
    const [b] = await db
      .insert(servers)
      .values({
        name: 'beta',
        module: 'fakepanel',
        hostname: 'b.test',
        credentialsEncrypted: creds,
        groupName: 'fake-pool',
        maxAccounts: 10,
      })
      .returning();
    ids.srvA = (a as { id: string }).id;
    ids.srvB = (b as { id: string }).id;
    // alpha already carries 3 services → beta must be picked
    for (let i = 0; i < 3; i++) {
      await db.insert(services).values({
        clientId: ids.client,
        productId: ids.product,
        serverId: ids.srvA,
        status: 'active',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: `old${i}.test`,
      });
    }
    const [svc] = await db
      .insert(services)
      .values({
        clientId: ids.client,
        productId: ids.product,
        status: 'pending',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: 'new.test',
      })
      .returning();
    ids.service = (svc as { id: string }).id;
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(() => {
    calls.length = 0;
    failWith = null;
    vi.mocked(enqueue).mockClear();
  });

  it('creates on the least-loaded server, stores username, encrypted password and module data', async () => {
    const result = await create(ctx, { serviceId: ids.service }, job());
    expect(result).toMatchObject({ serverId: ids.srvB, username: 'u1' });
    expect(calls).toEqual(['create:gold:beta']);
    const [svc] = await db.select().from(services).where(eq(services.id, ids.service));
    expect(svc).toMatchObject({
      status: 'active',
      serverId: ids.srvB,
      username: 'u1',
      moduleData: { acct: 'u1' },
    });
    expect(decrypt(svc?.passwordEncrypted as string)).toBe('Generated-Pass-1');
    const logs = await db
      .select()
      .from(provisioningLog)
      .where(eq(provisioningLog.serviceId, ids.service));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'create', status: 'success', serverId: ids.srvB });
  });

  it('is idempotent for an already active service', async () => {
    await create(ctx, { serviceId: ids.service }, job());
    expect(calls).toEqual([]);
  });

  it('suspends with reason and terminates', async () => {
    await suspend(ctx, { serviceId: ids.service, reason: 'Non-payment' }, job());
    expect(calls).toEqual(['suspend:Non-payment']);
    let [svc] = await db.select().from(services).where(eq(services.id, ids.service));
    expect(svc?.status).toBe('suspended');
    await terminate(ctx, { serviceId: ids.service }, job());
    [svc] = await db.select().from(services).where(eq(services.id, ids.service));
    expect(svc?.status).toBe('terminated');
    await expect(suspend(ctx, { serviceId: ids.service }, job())).rejects.toThrow(/cannot suspend/);
  });

  it('retries on intermediate failures and flags the service on the final attempt', async () => {
    const [svc] = await db
      .insert(services)
      .values({
        clientId: ids.client,
        productId: ids.product,
        status: 'pending',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: 'fail.test',
      })
      .returning();
    const id = (svc as { id: string }).id;
    failWith = new Error('panel exploded');
    await expect(create(ctx, { serviceId: id }, job(0, 3))).rejects.toThrow('panel exploded');
    let [row] = await db.select().from(services).where(eq(services.id, id));
    expect(row?.moduleData).toEqual({});
    await expect(create(ctx, { serviceId: id }, job(2, 3))).rejects.toThrow('panel exploded');
    [row] = await db.select().from(services).where(eq(services.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.moduleData).toMatchObject({
      lastError: { action: 'create', message: 'panel exploded' },
    });
    const logs = await db.select().from(provisioningLog).where(eq(provisioningLog.serviceId, id));
    expect(logs.map((l) => [l.status, (l.details as { final: boolean }).final])).toEqual([
      ['failed', false],
      ['failed', true],
    ]);
  });

  it('fails permanently when no server has capacity', async () => {
    await db.update(servers).set({ maxAccounts: 1 }).where(eq(servers.groupName, 'fake-pool'));
    const [svc] = await db
      .insert(services)
      .values({
        clientId: ids.client,
        productId: ids.product,
        status: 'pending',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: 'full.test',
      })
      .returning();
    await expect(create(ctx, { serviceId: (svc as { id: string }).id }, job())).rejects.toThrow(
      /no server with free capacity/,
    );
    await db.update(servers).set({ maxAccounts: 10 }).where(eq(servers.groupName, 'fake-pool'));
  });

  it('syncs usage into service_usage (upsert) and fans out without serviceId', async () => {
    const [svc] = await db
      .insert(services)
      .values({
        clientId: ids.client,
        productId: ids.product,
        serverId: ids.srvA,
        status: 'active',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: 'usage.test',
        moduleData: { acct: 'u9' },
      })
      .returning();
    const id = (svc as { id: string }).id;
    await syncUsage(ctx, { serviceId: id }, job());
    await syncUsage(ctx, { serviceId: id }, job());
    const [u] = await db.select().from(serviceUsage).where(eq(serviceUsage.serviceId, id));
    expect(u).toMatchObject({ diskUsedMb: 12, diskLimitMb: 100, extra: { status: 'running' } });
    const out = (await syncUsage(ctx, {}, job())) as { enqueued: number };
    expect(out.enqueued).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(enqueue)).toHaveBeenCalledWith(
      'provisioning',
      'syncUsage',
      { serviceId: id },
      expect.anything(),
    );
  });

  it('testConnection stores the result on the server row', async () => {
    const ok = await testConnection(ctx, { serverId: ids.srvA }, job());
    expect(ok).toEqual({ ok: true, message: 'fine' });
    const [row] = await db.select().from(servers).where(eq(servers.id, ids.srvA));
    expect(row).toMatchObject({ statusOk: true, statusMessage: 'fine' });
    await db
      .update(servers)
      .set({ credentialsEncrypted: encryptJson({ token: 'wrong-one' }) })
      .where(eq(servers.id, ids.srvB));
    expect(await testConnection(ctx, { serverId: ids.srvB }, job())).toMatchObject({ ok: false });
  });

  it('activate-order rejects unknown orders', async () => {
    await expect(
      activateOrder(ctx, { orderId: '00000000-0000-7000-8000-000000000000' }, job()),
    ).rejects.toThrow(/not found/);
  });
});

import { describe, expect, it } from 'vitest';
import { bytesToMb, PleskError } from './client.js';
import plesk from './index.js';
import {
  ctxWith,
  expectCall,
  fakeFetch,
  json,
  makeServer,
  makeService,
  text,
} from './test-utils.js';

const creds = { apiKey: 'plesk-api-key-123' };
const config = plesk.configSchema.parse({ servicePlan: 'Unlimited' });
const provisioned = {
  customerId: 7,
  customerLogin: 'examplecl',
  domainId: 42,
  domain: 'example-client.test',
  sysUser: 'examplecl',
  servicePlan: 'Unlimited',
};

function setup(
  routes: Parameters<typeof fakeFetch>[0],
  cfg = config,
  c: Record<string, unknown> = creds,
) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(cfg, c, f.fetch) };
}

describe('plesk provisioner', () => {
  it('validates credentials: api key or basic auth', () => {
    const s = plesk.credentialsSchema;
    expect(s?.safeParse({}).success).toBe(false);
    expect(s?.safeParse({ username: 'admin' }).success).toBe(false);
    expect(s?.safeParse({ username: 'admin', password: 'x' }).success).toBe(true);
    expect(s?.safeParse({ apiKey: 'plesk-api-key-123' }).success).toBe(true);
  });

  it('creates customer + subscription and returns module data', async () => {
    const { ctx, calls } = setup([
      (r) =>
        r.url.endsWith('/api/v2/clients') && r.method === 'POST'
          ? json({ id: 7, guid: 'g' })
          : undefined,
      (r) =>
        r.url.endsWith('/api/v2/domains') && r.method === 'POST'
          ? json({ id: 42, guid: 'd' })
          : undefined,
    ]);
    const res = await plesk.create(ctx, makeService({ password: 'Secret-Pass-1' }));
    const c0 = expectCall(calls, 0, 'https://panel.example.test:8443/api/v2/clients');
    expect(c0.headers['x-api-key']).toBe('plesk-api-key-123');
    expect(c0.json).toMatchObject({
      login: 'exampleclient',
      email: 'client@example.test',
      password: 'Secret-Pass-1',
    });
    const c1 = expectCall(calls, 1, '/api/v2/domains');
    expect(c1.json).toMatchObject({
      name: 'example-client.test',
      plan: { name: 'Unlimited' },
      owner_client: { id: 7 },
      hosting_settings: { ftp_login: 'exampleclient' },
    });
    expect(res).toMatchObject({
      username: 'exampleclient',
      password: 'Secret-Pass-1',
      moduleData: {
        customerId: 7,
        domainId: 42,
        sysUser: 'exampleclient',
        servicePlan: 'Unlimited',
      },
    });
  });

  it('uses basic auth and skips the customer when createCustomer=false', async () => {
    const { ctx, calls } = setup(
      [(r) => (r.url.endsWith('/domains') ? json({ id: 5 }) : undefined)],
      plesk.configSchema.parse({
        servicePlan: 'Basic',
        createCustomer: false,
        ipAddress: '198.51.100.5',
      }),
      { username: 'admin', password: 'pw' },
    );
    const res = await plesk.create(ctx, makeService({ username: 'fixeduser' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('admin:pw').toString('base64')}`,
    );
    expect(calls[0]?.json).toMatchObject({ ip_addresses: ['198.51.100.5'] });
    expect(calls[0]?.json).not.toHaveProperty('owner_client');
    expect(res.moduleData.customerId).toBeUndefined();
    expect(res.ipAddress).toBe('198.51.100.5');
  });

  it('rolls back the customer when the subscription fails', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/clients') && r.method === 'POST' ? json({ id: 9 }) : undefined),
      (r) =>
        r.url.endsWith('/domains')
          ? json({ code: 1023, message: 'Domain already exists' }, 400)
          : undefined,
      (r) =>
        r.url.endsWith('/clients/9') && r.method === 'DELETE' ? json({ status: 'ok' }) : undefined,
    ]);
    await expect(plesk.create(ctx, makeService())).rejects.toThrow('Domain already exists');
    expect(calls.at(-1)?.method).toBe('DELETE');
    expect(calls.at(-1)?.url).toContain('/clients/9');
  });

  it('requires a domain and surfaces auth / connection errors', async () => {
    await expect(plesk.create(setup([]).ctx, makeService({ domain: null }))).rejects.toMatchObject({
      code: 'domain_required',
    });
    const auth = setup([() => json({ message: 'Unauthorized' }, 401)]);
    expect(await plesk.testConnection(auth.ctx, makeServer())).toMatchObject({
      ok: false,
      message: /credentials/,
    });
    const html = setup([() => text('<html>', 200, 'text/html')]);
    await expect(
      plesk.suspend(html.ctx, makeService({ moduleData: provisioned })),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
    const down = setup([
      () => {
        throw new Error('ETIMEDOUT');
      },
    ]);
    await expect(
      plesk.suspend(down.ctx, makeService({ moduleData: provisioned })),
    ).rejects.toMatchObject({
      code: 'connection_failed',
    });
  });

  it('suspends and activates the subscription', async () => {
    const { ctx, calls } = setup([() => json({})]);
    const svc = makeService({ moduleData: provisioned });
    await plesk.suspend(ctx, svc);
    await plesk.unsuspend(ctx, svc);
    expect(calls[0]).toMatchObject({ method: 'PUT', json: { status: 'suspended' } });
    expect(calls[0]?.url).toContain('/domains/42/status');
    expect(calls[1]?.json).toEqual({ status: 'active' });
    await expect(plesk.suspend(ctx, makeService())).rejects.toMatchObject({
      code: 'not_provisioned',
    });
    await expect(
      plesk.suspend(ctx, makeService({ server: null, moduleData: provisioned })),
    ).rejects.toMatchObject({ code: 'no_server' });
  });

  it('terminates domain + customer and tolerates already-deleted resources', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/domains/42') ? json({ message: 'not found' }, 404) : undefined),
      (r) => (r.url.endsWith('/clients/7') ? json({ status: 'ok' }) : undefined),
    ]);
    await plesk.terminate(ctx, makeService({ moduleData: provisioned }));
    expect(calls.map((c) => `${c.method} ${c.url.split('/api/v2')[1]}`)).toEqual([
      'DELETE /domains/42',
      'DELETE /clients/7',
    ]);
    const boom = setup([() => json({ message: 'Internal' }, 500)]);
    await expect(
      plesk.terminate(boom.ctx, makeService({ moduleData: provisioned })),
    ).rejects.toBeInstanceOf(PleskError);
  });

  it('changes plan and password through the CLI gateway and reports CLI failures', async () => {
    const { ctx, calls } = setup([() => json({ code: 0, stdout: 'SUCCESS', stderr: '' })]);
    const svc = makeService({ moduleData: provisioned });
    await plesk.changePackage?.(ctx, svc, { ...svc.product, moduleConfig: { servicePlan: 'Pro' } });
    expect(calls[0]?.url).toContain('/cli/subscription/call');
    expect(calls[0]?.json).toEqual({
      params: ['--switch-subscription', 'example-client.test', '-service-plan', 'Pro'],
    });
    await plesk.changePassword?.(ctx, svc, 'NewPass-123');
    expect(calls[1]?.json).toEqual({ params: ['--update', 'examplecl', '-passwd', 'NewPass-123'] });
    expect(calls[2]?.json).toEqual({
      params: ['--update', 'example-client.test', '-login', 'examplecl', '-passwd', 'NewPass-123'],
    });
    const failing = setup([() => json({ code: 1, stdout: '', stderr: 'Unable to switch plan' })]);
    await expect(
      plesk.changePackage?.(failing.ctx, svc, {
        ...svc.product,
        moduleConfig: { servicePlan: 'Pro' },
      }),
    ).rejects.toMatchObject({ code: 'cli_error', message: 'Unable to switch plan' });
  });

  it('reads usage from domain statistics', async () => {
    const { ctx } = setup([
      () =>
        json({
          disk_space: { used: 2 * 1024 * 1024, limit: 10 * 1024 * 1024 },
          traffic: { used: 5 * 1024 * 1024, limit: 0 },
          mailboxes: 3,
        }),
    ]);
    expect(await plesk.getUsage?.(ctx, makeService({ moduleData: provisioned }))).toEqual({
      diskUsedMb: 2,
      diskLimitMb: 10,
      bandwidthUsedMb: 5,
      extra: { mailboxes: 3 },
    });
    expect(bytesToMb('x')).toBeUndefined();
  });

  it('builds the SSO login link', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/auth/keys') ? json({ key: 'abc def' }) : undefined),
    ]);
    const url = await plesk.loginUrl?.(ctx, makeService({ moduleData: provisioned }));
    expect(url).toBe('https://panel.example.test:8443/login?secret=abc%20def');
    expect(calls[0]?.json).toEqual({ login: 'examplecl' });
    const bad = setup([() => json({})]);
    await expect(
      plesk.loginUrl?.(bad.ctx, makeService({ moduleData: provisioned })),
    ).rejects.toMatchObject({
      code: 'no_login_key',
    });
  });

  it('tests connection and lists hosting plans only', async () => {
    const { ctx } = setup([
      (r) =>
        r.url.endsWith('/server')
          ? json({ hostname: 'plesk.example.test', platform: 'Unix' })
          : undefined,
      (r) =>
        r.url.endsWith('/service-plans')
          ? json([
              { id: 1, name: 'Unlimited', type: 'hosting' },
              { id: 2, name: 'Reseller Gold', type: 'reseller' },
            ])
          : undefined,
    ]);
    expect(await plesk.testConnection(ctx, makeServer())).toEqual({
      ok: true,
      message: 'Plesk on plesk.example.test',
    });
    expect(await plesk.listRemoteOptions?.(ctx, makeServer(), 'plans')).toEqual([
      { id: 'Unlimited', name: 'Unlimited', extra: { pleskId: 1, type: 'hosting' } },
    ]);
    expect(await plesk.listRemoteOptions?.(ctx, makeServer(), 'nodes')).toEqual([]);
  });
});

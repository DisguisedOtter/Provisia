import { describe, expect, it } from 'vitest';
import { CpanelError, parseWhmSizeMb } from './client.js';
import cpanel from './index.js';
import {
  ctxWith,
  expectCall,
  fakeFetch,
  json,
  makeServer,
  makeService,
  text,
} from './test-utils.js';

const creds = { username: 'root', apiToken: 'TOKEN1234567890' };
const config = cpanel.configSchema.parse({ package: 'starter' });
const ok = (data: Record<string, unknown>) => json({ metadata: { result: 1, reason: 'OK' }, data });
const fail = (reason: string) => json({ metadata: { result: 0, reason }, data: {} });

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(config, creds, f.fetch) };
}

describe('cpanel provisioner', () => {
  it('declares schemas', () => {
    expect(cpanel.id).toBe('cpanel');
    expect(cpanel.configSchema.safeParse({}).success).toBe(false);
    expect(cpanel.credentialsSchema?.safeParse({ apiToken: 'x' }).success).toBe(false);
    expect(cpanel.credentialsSchema?.parse({ apiToken: 'TOKEN1234567890' })).toMatchObject({
      username: 'root',
    });
  });

  it('creates an account with derived username and returns module data', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/json-api/createacct') ? ok({ ip: '203.0.113.10' }) : undefined),
    ]);
    const res = await cpanel.create(ctx, makeService({ password: 'Secret-Pass-1' }));
    const call = expectCall(calls, 0, 'https://panel.example.test:2087/json-api/createacct');
    expect(call.headers.authorization).toBe('whm root:TOKEN1234567890');
    expect(call.params.get('username')).toBe('examplec');
    expect(call.params.get('domain')).toBe('example-client.test');
    expect(call.params.get('plan')).toBe('starter');
    expect(call.params.get('password')).toBe('Secret-Pass-1');
    expect(call.params.get('reseller')).toBe('0');
    expect(call.params.get('api.version')).toBe('1');
    expect(res).toMatchObject({
      username: 'examplec',
      password: 'Secret-Pass-1',
      ipAddress: '203.0.113.10',
      moduleData: { username: 'examplec', package: 'starter' },
    });
  });

  it('applies ACLs for reseller products and generates a password when absent', async () => {
    const { calls, fetch } = fakeFetch([
      (r) => (r.url.includes('/json-api/') ? ok({}) : undefined),
    ]);
    const ctx = ctxWith(
      cpanel.configSchema.parse({ package: 'reseller1', reseller: true, aclList: 'resellers' }),
      creds,
      fetch,
    );
    const res = await cpanel.create(ctx, makeService({ username: 'fixed' }));
    expect(calls[0]?.params.get('reseller')).toBe('1');
    expect(calls[0]?.params.get('username')).toBe('fixed');
    expectCall(calls, 1, '/json-api/setacls');
    expect(calls[1]?.params.get('acllist')).toBe('resellers');
    expect(res.password).toMatch(/.{12,}/);
  });

  it('rejects create without a domain', async () => {
    const { ctx } = setup([]);
    await expect(cpanel.create(ctx, makeService({ domain: null }))).rejects.toMatchObject({
      code: 'domain_required',
    });
  });

  it('surfaces WHM api errors with the reason', async () => {
    const { ctx } = setup([() => fail('Sorry, a group for that username already exists.')]);
    await expect(cpanel.create(ctx, makeService())).rejects.toThrow(/already exists/);
  });

  it('maps 401 to auth_failed and non-JSON to invalid_response', async () => {
    const a = setup([() => text('denied', 401)]);
    await expect(a.ctx && cpanel.testConnection(a.ctx, makeServer())).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('API token'),
    });
    const b = setup([() => text('<html>oops</html>', 200, 'text/html')]);
    await expect(cpanel.suspend(b.ctx, makeService({ username: 'u1' }))).rejects.toMatchObject({
      code: 'invalid_response',
    });
    const c = setup([
      () => {
        throw new Error('ECONNREFUSED');
      },
    ]);
    await expect(cpanel.suspend(c.ctx, makeService({ username: 'u1' }))).rejects.toMatchObject({
      code: 'connection_failed',
    });
  });

  it('suspends, unsuspends and terminates by username', async () => {
    const { ctx, calls } = setup([() => ok({})]);
    const svc = makeService({ username: 'acme' });
    await cpanel.suspend(ctx, svc, 'Non-payment');
    await cpanel.unsuspend(ctx, svc);
    await cpanel.terminate(ctx, svc);
    expect(calls.map((c) => c.url.split('/json-api/')[1])).toEqual([
      'suspendacct',
      'unsuspendacct',
      'removeacct',
    ]);
    expect(calls[0]?.params.get('reason')).toBe('Non-payment');
    expect(calls[0]?.params.get('user')).toBe('acme');
    expect(calls[2]?.params.get('keepdns')).toBe('0');
  });

  it('fails clearly when the service has no username or server', async () => {
    const { ctx } = setup([() => ok({})]);
    await expect(cpanel.suspend(ctx, makeService())).rejects.toBeInstanceOf(CpanelError);
    await expect(
      cpanel.suspend(ctx, makeService({ server: null, username: 'x' })),
    ).rejects.toMatchObject({ code: 'no_server' });
  });

  it('changes package and password', async () => {
    const { ctx, calls } = setup([() => ok({})]);
    const svc = makeService({ username: 'acme' });
    await cpanel.changePackage?.(ctx, svc, { ...svc.product, moduleConfig: { package: 'pro' } });
    await cpanel.changePassword?.(ctx, svc, 'NewPass-123');
    expect(calls[0]?.params.get('pkg')).toBe('pro');
    expectCall(calls, 1, '/json-api/passwd');
    expect(calls[1]?.params.get('password')).toBe('NewPass-123');
  });

  it('reads usage from accountsummary + showbw', async () => {
    const { ctx } = setup([
      (r) =>
        r.url.endsWith('accountsummary')
          ? ok({
              acct: [
                {
                  diskused: '512M',
                  disklimit: '10240M',
                  suspended: 0,
                  ip: '1.2.3.4',
                  plan: 'starter',
                },
              ],
            })
          : undefined,
      (r) =>
        r.url.endsWith('showbw')
          ? ok({ acct: [{ totalbytes: 3 * 1024 * 1024, limit: 1024 * 1024 * 1024 }] })
          : undefined,
    ]);
    const usage = await cpanel.getUsage?.(ctx, makeService({ username: 'acme' }));
    expect(usage).toEqual({
      diskUsedMb: 512,
      diskLimitMb: 10240,
      bandwidthUsedMb: 3,
      bandwidthLimitMb: 1024,
      extra: { suspended: 0, ip: '1.2.3.4', package: 'starter' },
    });
  });

  it('parses WHM sizes', () => {
    expect(parseWhmSizeMb('unlimited')).toBeNull();
    expect(parseWhmSizeMb('1.5G')).toBe(1536);
    expect(parseWhmSizeMb('2048K')).toBe(2);
    expect(parseWhmSizeMb('100')).toBe(100);
    expect(parseWhmSizeMb('weird')).toBeNull();
  });

  it('creates SSO sessions and fails when WHM returns none', async () => {
    const good = setup([
      () => ok({ url: 'https://panel.example.test:2083/cpsess1/login?session=x' }),
    ]);
    await expect(
      good.ctx && cpanel.loginUrl?.(good.ctx, makeService({ username: 'acme' })),
    ).resolves.toContain('cpsess1');
    expect(good.calls[0]?.params.get('service')).toBe('cpaneld');
    const bad = setup([() => ok({})]);
    await expect(
      cpanel.loginUrl?.(bad.ctx, makeService({ username: 'acme' })),
    ).rejects.toMatchObject({
      code: 'no_session_url',
    });
  });

  it('tests the connection and lists packages', async () => {
    const { ctx } = setup([
      (r) => (r.url.endsWith('/version') ? ok({ version: '126.0.12' }) : undefined),
      (r) =>
        r.url.endsWith('/listpkgs')
          ? ok({ pkg: [{ name: 'starter', QUOTA: '10240', BWLIMIT: 'unlimited', MAXADDON: '0' }] })
          : undefined,
    ]);
    expect(await cpanel.testConnection(ctx, makeServer())).toEqual({
      ok: true,
      message: 'WHM 126.0.12',
    });
    expect(await cpanel.listRemoteOptions?.(ctx, makeServer(), 'packages')).toEqual([
      {
        id: 'starter',
        name: 'starter',
        extra: { quota: '10240', bandwidth: 'unlimited', maxAddons: '0' },
      },
    ]);
    expect(await cpanel.listRemoteOptions?.(ctx, makeServer(), 'templates')).toEqual([]);
  });

  it('honours custom port and plain http', async () => {
    const { ctx, calls } = setup([() => ok({ version: '1' })]);
    await cpanel.testConnection(ctx, makeServer({ port: 2086, secure: false }));
    expect(calls[0]?.url.startsWith('http://panel.example.test:2086/')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { DirectadminError, parseDaBody, parseUrlEncoded } from './client.js';
import directadmin from './index.js';
import {
  ctxWith,
  expectCall,
  fakeFetch,
  json,
  makeServer,
  makeService,
  text,
} from './test-utils.js';

const creds = { username: 'admin', loginKey: 'loginkey-123456' };
const config = directadmin.configSchema.parse({ package: 'basic' });
const urlencoded = (s: string, status = 200) => text(s, status, 'text/html');

function setup(routes: Parameters<typeof fakeFetch>[0], cfg = config) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(cfg, creds, f.fetch) };
}

describe('directadmin response parsing', () => {
  it('parses url-encoded bodies incl. lists and errors', () => {
    expect(parseUrlEncoded('error=1&text=Cannot%20Create&details=user%20exists')).toEqual({
      error: '1',
      text: 'Cannot Create',
      details: 'user exists',
    });
    expect(parseUrlEncoded('list[]=basic&list[]=pro')).toEqual({ list: ['basic', 'pro'] });
  });
  it('prefers JSON when present', () => {
    expect(parseDaBody('{"error":"0","text":"ok"}', 'application/json')).toEqual({
      error: '0',
      text: 'ok',
    });
    expect(parseDaBody('["basic","pro"]', null)).toEqual(['basic', 'pro']);
    expect(parseDaBody('error=0&text=ok', 'text/html')).toEqual({ error: '0', text: 'ok' });
  });
});

describe('directadmin provisioner', () => {
  it('creates an account with the shared reseller IP', async () => {
    const { ctx, calls } = setup([
      (r) =>
        r.url.includes('CMD_API_SHOW_RESELLER_IPS')
          ? urlencoded('list[]=198.51.100.7&list[]=198.51.100.8')
          : undefined,
      (r) =>
        r.url.endsWith('CMD_API_ACCOUNT_USER')
          ? json({ error: '0', text: 'User created', details: '' })
          : undefined,
    ]);
    const res = await directadmin.create(ctx, makeService({ password: 'Secret-Pass-1' }));
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('admin:loginkey-123456').toString('base64')}`,
    );
    const create = expectCall(calls, 1, 'https://panel.example.test:2222/CMD_API_ACCOUNT_USER');
    expect(Object.fromEntries(create.params)).toMatchObject({
      json: 'yes',
      action: 'create',
      add: 'Submit',
      username: 'examplecli',
      email: 'client@example.test',
      passwd: 'Secret-Pass-1',
      passwd2: 'Secret-Pass-1',
      domain: 'example-client.test',
      package: 'basic',
      ip: '198.51.100.7',
      notify: 'no',
    });
    expect(res).toMatchObject({
      username: 'examplecli',
      ipAddress: '198.51.100.7',
      moduleData: { package: 'basic' },
    });
  });

  it('uses the server IP or a literal IP without lookups', async () => {
    const a = setup(
      [() => json({ error: '0' })],
      directadmin.configSchema.parse({ package: 'basic', ip: 'server' }),
    );
    await directadmin.create(a.ctx, makeService({ username: 'u1' }));
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0]?.params.get('ip')).toBe('203.0.113.10');
    const b = setup(
      [() => json({ error: '0' })],
      directadmin.configSchema.parse({ package: 'basic', ip: '192.0.2.9' }),
    );
    await directadmin.create(b.ctx, makeService({ username: 'u1' }));
    expect(b.calls[0]?.params.get('ip')).toBe('192.0.2.9');
  });

  it('fails when no IP can be resolved or the domain is missing', async () => {
    const { ctx } = setup([() => urlencoded('')]);
    await expect(
      directadmin.create(ctx, makeService({ server: makeServer({ ipAddress: null }) })),
    ).rejects.toMatchObject({
      code: 'no_ip',
    });
    await expect(directadmin.create(ctx, makeService({ domain: null }))).rejects.toMatchObject({
      code: 'domain_required',
    });
  });

  it('turns error=1 responses (json and url-encoded) into DirectadminError', async () => {
    const a = setup([
      () =>
        urlencoded(
          'error=1&text=Cannot%20Create%20Account&details=That%20username%20already%20exists',
        ),
    ]);
    await expect(directadmin.create(a.ctx, makeService({ username: 'dup' }))).rejects.toThrow(
      'Cannot Create Account: That username already exists',
    );
    const b = setup([() => json({ error: '1', text: 'Unable to suspend', details: '' })]);
    await expect(directadmin.suspend(b.ctx, makeService({ username: 'u' }))).rejects.toMatchObject({
      code: 'api_error',
    });
    const c = setup([() => text('nope', 401)]);
    await expect(directadmin.suspend(c.ctx, makeService({ username: 'u' }))).rejects.toMatchObject({
      code: 'auth_failed',
    });
    const d = setup([
      () => {
        throw new Error('ECONNRESET');
      },
    ]);
    await expect(directadmin.suspend(d.ctx, makeService({ username: 'u' }))).rejects.toMatchObject({
      code: 'connection_failed',
    });
    await expect(directadmin.suspend(d.ctx, makeService())).rejects.toMatchObject({
      code: 'no_username',
    });
    await expect(
      directadmin.suspend(d.ctx, makeService({ username: 'u', server: null })),
    ).rejects.toBeInstanceOf(DirectadminError);
  });

  it('suspends, unsuspends and deletes via CMD_API_SELECT_USERS', async () => {
    const { ctx, calls } = setup([() => json({ error: '0' })]);
    const svc = makeService({ username: 'acme' });
    await directadmin.suspend(ctx, svc);
    await directadmin.unsuspend(ctx, svc);
    await directadmin.terminate(ctx, svc);
    for (const c of calls) {
      expect(c.url).toContain('/CMD_API_SELECT_USERS');
      expect(c.params.get('select0')).toBe('acme');
      expect(c.params.get('location')).toBe('CMD_SELECT_USERS');
    }
    expect(calls[0]?.params.get('suspend')).toBe('Suspend');
    expect(calls[1]?.params.get('unsuspend')).toBe('Unsuspend');
    expect(calls[2]?.params.get('delete')).toBe('yes');
    expect(calls[2]?.params.get('confirmed')).toBe('Confirm');
  });

  it('changes package and password', async () => {
    const { ctx, calls } = setup([() => json({ error: '0' })]);
    const svc = makeService({ username: 'acme' });
    await directadmin.changePackage?.(ctx, svc, {
      ...svc.product,
      moduleConfig: { package: 'pro' },
    });
    await directadmin.changePassword?.(ctx, svc, 'NewPass-123');
    expect(calls[0]?.url).toContain('CMD_API_MODIFY_USER');
    expect(Object.fromEntries(calls[0]?.params ?? [])).toMatchObject({
      action: 'package',
      user: 'acme',
      package: 'pro',
    });
    expect(calls[1]?.url).toContain('CMD_API_USER_PASSWD');
    expect(Object.fromEntries(calls[1]?.params ?? [])).toMatchObject({
      username: 'acme',
      passwd: 'NewPass-123',
      passwd2: 'NewPass-123',
    });
  });

  it('reads usage and limits', async () => {
    const { ctx } = setup([
      (r) =>
        r.url.includes('CMD_API_SHOW_USER_USAGE')
          ? urlencoded('bandwidth=1234.5&quota=250&vdomains=2&nemails=5&inode=unlimited')
          : undefined,
      (r) =>
        r.url.includes('CMD_API_SHOW_USER_CONFIG')
          ? json({ bandwidth: '10000', quota: 'unlimited', suspended: 'no', package: 'basic' })
          : undefined,
    ]);
    expect(await directadmin.getUsage?.(ctx, makeService({ username: 'acme' }))).toEqual({
      diskUsedMb: 250,
      diskLimitMb: undefined,
      bandwidthUsedMb: 1234.5,
      bandwidthLimitMb: 10000,
      extra: { vdomains: 2, nemails: 5, suspended: 'no', package: 'basic' },
    });
  });

  it('creates one-time login URLs impersonating the user', async () => {
    const { ctx, calls } = setup([
      () =>
        json({
          error: '0',
          text: 'Created',
          details: 'https://panel.example.test:2222/api/login/abc',
        }),
    ]);
    const url = await directadmin.loginUrl?.(ctx, makeService({ username: 'acme' }));
    expect(url).toBe('https://panel.example.test:2222/api/login/abc');
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('admin|acme:loginkey-123456').toString('base64')}`,
    );
    expect(Object.fromEntries(calls[0]?.params ?? [])).toMatchObject({
      type: 'one_time_url',
      expiry: '30m',
      passwd: 'loginkey-123456',
    });
    const bad = setup([() => json({ error: '0', details: 'Created' })]);
    await expect(
      directadmin.loginUrl?.(bad.ctx, makeService({ username: 'acme' })),
    ).rejects.toMatchObject({ code: 'no_login_url' });
  });

  it('tests connection and lists packages (json list and url-encoded)', async () => {
    const a = setup([
      (r) => (r.url.includes('CMD_API_LICENSE') ? urlencoded('version=1.670&uid=1234') : undefined),
      (r) => (r.url.includes('CMD_API_PACKAGES_USER') ? json(['basic', 'pro']) : undefined),
    ]);
    expect(await directadmin.testConnection(a.ctx, makeServer())).toEqual({
      ok: true,
      message: 'DirectAdmin 1.670',
    });
    expect(await directadmin.listRemoteOptions?.(a.ctx, makeServer(), 'packages')).toEqual([
      { id: 'basic', name: 'basic' },
      { id: 'pro', name: 'pro' },
    ]);
    const b = setup([() => urlencoded('list[]=starter')]);
    expect(await directadmin.listRemoteOptions?.(b.ctx, makeServer(), 'packages')).toEqual([
      { id: 'starter', name: 'starter' },
    ]);
    expect(await directadmin.listRemoteOptions?.(b.ctx, makeServer(), 'plans')).toEqual([]);
    const down = setup([() => text('bad gateway', 502)]);
    expect(await directadmin.testConnection(down.ctx, makeServer())).toMatchObject({
      ok: false,
      message: /502/,
    });
  });
});

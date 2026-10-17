import { createServer } from 'node:http';
import { SkrimeClient } from '@provisia/registrar-skrime';
import { describe, expect, it } from 'vitest';
import { osOption, SkrimeProvisionError, serverPlanOption, webspacePlanOption } from './client.js';
import { skrimeServer, skrimeWebspace } from './index.js';
import {
  ctxWith,
  expectCall,
  fakeFetch,
  json,
  makeServer,
  makeService,
  silentLogger,
  text,
} from './test-utils.js';

const creds = { apiKey: 'sk-test-api-key-1234567890' };
const ok = (data: unknown) => json({ state: 'success', response: 'OK', data });
const fail = (response: string, status = 200) => json({ state: 'error', response }, status);
const PLAN = '11111111-2222-7333-8444-555555555555';
const PRODUCT = '99999999-2222-7333-8444-555555555555';
const webCfg = skrimeWebspace.configSchema.parse({ planId: PLAN });
const srvCfg = skrimeServer.configSchema.parse({ planId: PLAN, osName: 'debian-12' });
const BASE = 'https://skrime.eu/api/';
const path = (r: { url: string }) => r.url.replace(BASE, '').split('?')[0];
const query = (r: { url: string }) => Object.fromEntries(new URL(r.url).searchParams);
const extra = (mod: typeof skrimeServer, id: string) => {
  const a = mod.extras?.find((x) => x.id === id);
  if (!a) throw new Error(`extra ${id} missing`);
  return a;
};

function web(routes: Parameters<typeof fakeFetch>[0], config = webCfg) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(config, creds, f.fetch) };
}
function srv(routes: Parameters<typeof fakeFetch>[0], config = srvCfg) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(config, creds, f.fetch) };
}
const svc = (over: Record<string, unknown> = {}) =>
  makeService({
    domain: null,
    moduleData: {
      productId: PRODUCT,
      planId: PLAN,
      osName: 'debian-12',
      hostname: 'vps-1',
      ipv4: '203.0.113.7',
      memoryMb: 8192,
      diskGb: 100,
    },
    ...over,
  });

describe('helpers and schemas', () => {
  it('maps price lists and OS images to dropdown options', () => {
    expect(
      serverPlanOption({
        id: PLAN,
        productInfo: { cores: 4, memory: 8192, disk: 100, type: 'epyc' },
        price: '9.99',
        finalRenewPrice: '8.99',
      }),
    ).toEqual({
      id: PLAN,
      name: '4 vCPU · 8 GB RAM · 100 GB · EPYC – € 8.99/mo',
      extra: { priceEur: 8.99, cores: 4, memoryMb: 8192, diskGb: 100, type: 'epyc' },
    });
    expect(
      osOption({
        id: 'x',
        name: 'Debian 12',
        proxmoxId: 'debian-12',
        type: 'os',
        group: 'Debian',
        minDisk: 10,
      }),
    ).toEqual({
      id: 'debian-12',
      name: 'Debian 12',
      extra: { group: 'Debian', type: 'os', minDisk: 10 },
    });
    expect(
      webspacePlanOption({
        id: PLAN,
        productInfo: { name: 'Webspace S', disk: 10 },
        price: '2.99',
      }),
    ).toEqual({
      id: PLAN,
      name: 'Webspace S (10 GB) – € 2.99/mo',
      extra: { priceEur: 2.99, diskGb: 10 },
    });
  });

  it('declares schemas, credentials and extras', () => {
    expect(skrimeWebspace.id).toBe('skrime_webspace');
    expect(skrimeServer.id).toBe('skrime_server');
    expect(skrimeWebspace.configSchema.safeParse({}).success).toBe(false);
    expect(skrimeServer.configSchema.safeParse({ osName: 'debian-12' }).success).toBe(false);
    expect(
      skrimeServer.configSchema.safeParse({
        osName: 'debian-12',
        cores: 2,
        memoryGb: 4,
        diskGb: 50,
      }).success,
    ).toBe(true);
    expect(skrimeWebspace.credentialsSchema?.parse(creds)).toMatchObject({
      baseUrl: 'https://skrime.eu/api',
      getParamsIn: 'query',
    });
    expect(skrimeServer.extras?.map((e) => e.id)).toEqual([
      'console',
      'network',
      'rdns.set',
      'rdns.delete',
      'firewall.list',
      'firewall.create',
      'firewall.edit',
      'firewall.move',
      'firewall.delete',
      'ddos.stats',
      'ddos.attacks',
      'statistics',
      'backup.list',
      'backup.restore',
      'os.list',
      'reinstall',
      'ip.add',
      'product.log',
    ]);
    expect(skrimeServer.extras?.filter((e) => e.audience === 'staff').map((e) => e.id)).toEqual([
      'ip.add',
      'product.log',
    ]);
  });
});

describe('skrime client GET parameter modes', () => {
  it('sends GET parameters as a JSON body when configured (node:https) and as a query string by default', async () => {
    const seen: Array<{ method?: string; url?: string; body: string; auth?: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ state: 'success', data: { echoed: true } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const bodyClient = new SkrimeClient({
      apiKey: 'k'.repeat(12),
      baseUrl: `http://127.0.0.1:${port}`,
      fetch: fetch as never,
      logger: silentLogger,
      getParamsIn: 'body',
    });
    expect(await bodyClient.get('server/information', { productId: PRODUCT, lazy: true })).toEqual({
      echoed: true,
    });
    expect(seen[0]).toMatchObject({
      method: 'GET',
      url: '/server/information',
      body: JSON.stringify({ productId: PRODUCT, lazy: true }),
      auth: `Bearer ${'k'.repeat(12)}`,
    });
    const { fetch: f, calls } = fakeFetch([() => ok({})]);
    const queryClient = new SkrimeClient({
      apiKey: 'k'.repeat(12),
      fetch: f as never,
      logger: silentLogger,
    });
    await queryClient.get('server/information', { productId: PRODUCT, lazy: true });
    expect(calls[0]?.url).toBe(
      `https://skrime.eu/api/server/information?productId=${PRODUCT}&lazy=true`,
    );
    server.close();
  });
});

describe('skrime webspace', () => {
  it('orders a plan, reads panel details back, enables auto renewal and names the product', async () => {
    const { ctx, calls } = web([
      (r) =>
        path(r) === 'webspace/order'
          ? ok({
              id: PRODUCT,
              state: 'active',
              productInfo: {
                username: 'webspace123',
                password: 'FromSkrime1',
                plan_id: 'Webspace S',
              },
              price: '2.99',
              finalRenewPrice: '2.49',
              expireAt: '2026-11-17 00:00:00',
            })
          : undefined,
      (r) =>
        path(r) === 'webspace/information'
          ? ok({
              domain: 'vweb12.skrime.eu',
              ipv4: '203.0.113.5',
              ipv6: 'fe80::1',
              username: 'webspace123',
              password: 'FromSkrime1',
              disk: { limit: '10240.00', used: '0.00' },
            })
          : undefined,
      (r) => (path(r) === 'product/autorenew' || path(r) === 'product/name' ? ok({}) : undefined),
    ]);
    const res = await skrimeWebspace.create(ctx, makeService({ domain: 'client.example' }));
    const order = expectCall(calls, 0, 'https://skrime.eu/api/webspace/order');
    expect(order.method).toBe('POST');
    expect(order.headers.authorization).toBe('Bearer sk-test-api-key-1234567890');
    expect(order.json).toEqual({ planId: PLAN, tos: true, cancellation: true });
    expect(query(calls[1] as { url: string })).toEqual({ productId: PRODUCT });
    expect(calls[2]?.json).toEqual({ productId: PRODUCT, autoRenew: true });
    expect(calls[3]?.json).toEqual({ productId: PRODUCT, name: 'client.example' });
    expect(res).toEqual({
      username: 'webspace123',
      password: 'FromSkrime1',
      ipAddress: '203.0.113.5',
      message: `Skrime webspace ${PRODUCT} ordered (Webspace S)`,
      moduleData: {
        productId: PRODUCT,
        planId: PLAN,
        planName: 'Webspace S',
        panelHost: 'vweb12.skrime.eu',
        username: 'webspace123',
        ipv4: '203.0.113.5',
        ipv6: 'fe80::1',
        costAmount: 249,
        costCurrency: 'EUR',
        expireAt: '2026-11-17 00:00:00',
      },
    });
  });

  it('sets its own password when Skrime returns none, skips auto renewal in manual mode', async () => {
    const { ctx, calls } = web(
      [
        (r) =>
          path(r) === 'webspace/order'
            ? ok({ id: PRODUCT, productInfo: { username: 'u9' } })
            : undefined,
        (r) => (path(r) === 'webspace/information' ? fail('No product found', 404) : undefined),
        (r) => (path(r) === 'webspace/passwd' || path(r) === 'product/name' ? ok({}) : undefined),
      ],
      skrimeWebspace.configSchema.parse({ planId: PLAN, renewal: 'manual' }),
    );
    const res = await skrimeWebspace.create(ctx, makeService());
    expect(calls.map(path)).toEqual([
      'webspace/order',
      'webspace/information',
      'webspace/passwd',
      'product/name',
    ]);
    expect(res.password).toMatch(/.{12,}/);
    expect((calls[2]?.json as { password: string } | undefined)?.password).toBe(res.password);
  });

  it('surfaces Skrime errors with stable codes', async () => {
    const { ctx } = web([
      (r) => (path(r) === 'webspace/order' ? fail('Insufficient balance') : undefined),
    ]);
    await expect(skrimeWebspace.create(ctx, makeService())).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('suspends by rotating the panel password and unsuspends with the stored one', async () => {
    const { ctx, calls } = web([(r) => (path(r) === 'webspace/passwd' ? ok({}) : undefined)]);
    const service = makeService({
      moduleData: { productId: PRODUCT, planId: PLAN },
      password: 'Known-1234',
    });
    await skrimeWebspace.suspend(ctx, service);
    await skrimeWebspace.unsuspend(ctx, service);
    expect((calls[0]?.json as { password: string } | undefined)?.password).not.toBe('Known-1234');
    expect(calls[1]?.json).toEqual({ productId: PRODUCT, password: 'Known-1234' });
    const { ctx: none, calls: noCalls } = web(
      [],
      skrimeWebspace.configSchema.parse({ planId: PLAN, suspendMode: 'none' }),
    );
    await skrimeWebspace.suspend(none, service);
    expect(noCalls).toHaveLength(0);
  });

  it('terminates by switching auto renewal off and tolerates a removed product', async () => {
    const { ctx, calls } = web([(r) => (path(r) === 'product/autorenew' ? ok({}) : undefined)]);
    const service = makeService({ moduleData: { productId: PRODUCT, planId: PLAN } });
    await skrimeWebspace.terminate(ctx, service);
    expect(calls[0]?.json).toEqual({ productId: PRODUCT, autoRenew: false });
    expect(service.moduleData.cancelledAt).toMatch(/^\d{4}-/);
    const { ctx: gone } = web([
      (r) => (path(r) === 'product/autorenew' ? fail('No product found', 404) : undefined),
    ]);
    await expect(skrimeWebspace.terminate(gone, service)).resolves.toBeUndefined();
    await expect(skrimeWebspace.terminate(ctx, makeService())).rejects.toBeInstanceOf(
      SkrimeProvisionError,
    );
  });

  it('upgrades, changes password, reports usage, logs in via SSO and runs extras', async () => {
    const { ctx, calls } = web([
      (r) =>
        path(r) === 'webspace/upgrade'
          ? ok({ productInfo: { plan_id: 'Webspace M' }, finalRenewPrice: '4.99' })
          : undefined,
      (r) => (path(r) === 'webspace/passwd' ? ok({}) : undefined),
      (r) =>
        path(r) === 'webspace/information'
          ? ok({
              domain: 'vweb12.skrime.eu',
              ipv4: '203.0.113.5',
              disk: { limit: '10240.00', used: '2048.50' },
            })
          : undefined,
      (r) =>
        path(r) === 'webspace/login'
          ? ok({ loginUrl: 'https://vweb12.skrime.eu/index.php?sso_request=abc' })
          : undefined,
      (r) =>
        path(r) === 'webspace/reinstall'
          ? ok({ username: 'webspace123', password: 'Fresh-Pass-1' })
          : undefined,
    ]);
    const service = makeService({ moduleData: { productId: PRODUCT, planId: PLAN } });
    await skrimeWebspace.changePackage?.(ctx, service, {
      ...service.product,
      moduleConfig: { planId: 'other-plan' },
    });
    expect(calls[0]?.json).toEqual({ productId: PRODUCT, planId: 'other-plan' });
    expect(service.moduleData).toMatchObject({
      planId: 'other-plan',
      planName: 'Webspace M',
      costAmount: 499,
    });
    await skrimeWebspace.changePassword?.(ctx, service, 'New-Pass-123');
    expect(calls[1]?.json).toEqual({ productId: PRODUCT, password: 'New-Pass-123' });
    expect(await skrimeWebspace.getUsage?.(ctx, service)).toEqual({
      diskUsedMb: 2048.5,
      diskLimitMb: 10240,
      extra: { status: 'active', panelHost: 'vweb12.skrime.eu' },
    });
    expect(service.moduleData.ipv4).toBe('203.0.113.5');
    expect(await skrimeWebspace.loginUrl?.(ctx, service)).toBe(
      'https://vweb12.skrime.eu/index.php?sso_request=abc',
    );
    expect(await extra(skrimeWebspace, 'info').run(ctx, service, {})).toEqual({
      panelHost: 'vweb12.skrime.eu',
      username: null,
      ipv4: '203.0.113.5',
      ipv6: null,
      diskUsedMb: 2048.5,
      diskLimitMb: 10240,
    });
    expect(
      await extra(skrimeWebspace, 'reinstall').run(ctx, service, { password: 'Fresh-Pass-1' }),
    ).toEqual({ username: 'webspace123', newPassword: 'Fresh-Pass-1' });
    expect(calls.at(-1)?.method).toBe('DELETE');
  });

  it('lists plans and tests the connection', async () => {
    const { ctx, calls } = web([
      (r) =>
        path(r) === 'webspace/pricelist'
          ? ok([{ id: PLAN, productInfo: { name: 'Webspace S', disk: 10 }, price: '2.99' }])
          : undefined,
      (r) => (path(r) === 'product/all' ? ok([]) : undefined),
    ]);
    expect(await skrimeWebspace.listRemoteOptions?.(ctx, makeServer(), 'plan')).toEqual([
      { id: PLAN, name: 'Webspace S (10 GB) – € 2.99/mo', extra: { priceEur: 2.99, diskGb: 10 } },
    ]);
    expect(await skrimeWebspace.listRemoteOptions?.(ctx, makeServer(), 'other')).toEqual([]);
    expect(await skrimeWebspace.testConnection(ctx, makeServer())).toEqual({
      ok: true,
      message: 'Skrime API key accepted',
    });
    expect(query(calls[1] as { url: string })).toEqual({ type: 'webspace' });
    const { ctx: bad } = web([() => text('Unauthorized', 401)]);
    expect(await skrimeWebspace.testConnection(bad, makeServer())).toMatchObject({
      ok: false,
      message: expect.stringContaining('API key'),
    });
  });
});

describe('skrime server', () => {
  it('orders a plan with the documented body, enables auto renewal and reads the ip back', async () => {
    const { ctx, calls } = srv([
      (r) =>
        path(r) === 'server/order'
          ? ok({
              id: PRODUCT,
              state: 'install',
              productInfo: { cores: 4, memory: 8192, disk: 100, password: 'Root-Pass-1' },
              price: '9.99',
              finalRenewPrice: '8.99',
              expireAt: '2026-11-17 00:00:00',
            })
          : undefined,
      (r) => (path(r) === 'product/autorenew' || path(r) === 'product/name' ? ok({}) : undefined),
      (r) =>
        path(r) === 'server/information'
          ? ok({ status: 'online', ipv4: '203.0.113.7', ipv6: 'fe80::7' })
          : undefined,
    ]);
    const res = await skrimeServer.create(
      ctx,
      makeService({ domain: null, password: 'Root-Pass-1' }),
    );
    const order = expectCall(calls, 0, 'https://skrime.eu/api/server/order');
    expect(order.json).toEqual({
      osName: 'debian-12',
      password: 'Root-Pass-1',
      tos: true,
      cancellation: true,
      notice: true,
      prepayMonths: 1,
      planId: PLAN,
    });
    expect(calls[1]?.json).toEqual({ productId: PRODUCT, autoRenew: true });
    expect(calls[2]?.json).toEqual({ productId: PRODUCT, name: 'vps-0000000a' });
    expect(query(calls[3] as { url: string })).toEqual({ productId: PRODUCT, lazy: 'true' });
    expect(res).toEqual({
      username: 'root',
      password: 'Root-Pass-1',
      ipAddress: '203.0.113.7',
      message: `Skrime server ${PRODUCT} ordered (vps-0000000a, 203.0.113.7)`,
      moduleData: {
        productId: PRODUCT,
        planId: PLAN,
        osName: 'debian-12',
        hostname: 'vps-0000000a',
        cores: 4,
        memoryMb: 8192,
        diskGb: 100,
        ipv4: '203.0.113.7',
        ipv6: 'fe80::7',
        costAmount: 899,
        costCurrency: 'EUR',
        expireAt: '2026-11-17 00:00:00',
      },
    });
  });

  it('orders through the configurator and uses the service domain as hostname', async () => {
    const cfg = skrimeServer.configSchema.parse({
      osName: 'ubuntu-24',
      cores: 2,
      memoryGb: 4,
      diskGb: 50,
      prepayMonths: 12,
      renewal: 'manual',
    });
    const { ctx, calls } = srv(
      [
        (r) => (path(r) === 'server/order' ? ok({ id: PRODUCT }) : undefined),
        (r) => (path(r) === 'product/name' ? ok({}) : undefined),
        (r) => (path(r) === 'server/information' ? fail('Server is installing') : undefined),
      ],
      cfg,
    );
    const res = await skrimeServer.create(ctx, makeService({ domain: 'Node1.Example.Test' }));
    expect(calls[0]?.json).toMatchObject({
      osName: 'ubuntu-24',
      cores: 2,
      memory: 4,
      disk: 50,
      ipv4: 1,
      ipv6: 1,
      connection: 10,
      prepayMonths: 12,
    });
    expect(calls.map(path)).toEqual(['server/order', 'product/name', 'server/information']);
    expect(res.moduleData).toMatchObject({
      productId: PRODUCT,
      hostname: 'node1.example.test',
      osName: 'ubuntu-24',
    });
    expect(res.moduleData.ipv4).toBeUndefined();
    expect(res.message).toContain('installing');
  });

  it('maps power (reboot = stop + start), suspend/unsuspend and terminate', async () => {
    const { ctx, calls } = srv([
      (r) => (path(r) === 'server/action' ? ok({}) : undefined),
      (r) => (path(r) === 'product/autorenew' ? ok({}) : undefined),
    ]);
    const service = svc();
    await skrimeServer.power?.(ctx, service, 'reboot');
    await skrimeServer.power?.(ctx, service, 'shutdown');
    await skrimeServer.suspend(ctx, service);
    await skrimeServer.unsuspend(ctx, service);
    await skrimeServer.terminate(ctx, service);
    expect(calls.map((c) => c.json)).toEqual([
      { productId: PRODUCT, action: 'stop' },
      { productId: PRODUCT, action: 'start' },
      { productId: PRODUCT, action: 'stop' },
      { productId: PRODUCT, action: 'stop' },
      { productId: PRODUCT, action: 'start' },
      { productId: PRODUCT, autoRenew: false },
      { productId: PRODUCT, action: 'stop' },
    ]);
    expect(service.moduleData.cancelledAt).toBeDefined();
  });

  it('reports usage from server/information and refreshes the ip', async () => {
    const { ctx } = srv([
      (r) =>
        path(r) === 'server/information'
          ? ok({
              status: 'online',
              os: 'Debian 12',
              ipv4: '203.0.113.8',
              coresUsed: '25.50',
              memoryUsed: '4.00',
              diskUsed: '10.00',
            })
          : undefined,
    ]);
    const service = svc();
    expect(await skrimeServer.getUsage?.(ctx, service)).toEqual({
      diskUsedMb: 10240,
      diskLimitMb: 102400,
      extra: {
        status: 'running',
        cpuPercent: 25.5,
        memoryUsedMb: 4096,
        memoryLimitMb: 8192,
        os: 'Debian 12',
        ip: '203.0.113.8',
      },
    });
    expect(service.moduleData.ipv4).toBe('203.0.113.8');
  });

  it('runs console, network, rdns, firewall, backup, reinstall and password extras with documented payloads', async () => {
    const { ctx, calls } = srv([
      (r) =>
        path(r) === 'server/novnc' ? ok({ url: 'https://novnc.eu/vnc.html#token=abc' }) : undefined,
      (r) =>
        path(r) === 'server/network'
          ? ok({
              ipv4: [
                { ipAddress: '203.0.113.7/24', gateway: '203.0.113.1', hostname: 'vps.example' },
              ],
              ipv6: [
                {
                  zone: 'fe80::/64',
                  ipAddress: 'fe80::/64',
                  gateway: 'fe80::',
                  hostname: 'vps.example',
                },
              ],
            })
          : undefined,
      (r) => (path(r) === 'server/rdns' ? ok({}) : undefined),
      (r) =>
        path(r) === 'server/firewall' && r.method === 'GET'
          ? ok({
              rules: [
                { pos: 0, type: 'in', action: 'ACCEPT', protocol: 'tcp', destinationPort: '22' },
              ],
            })
          : undefined,
      (r) => (path(r) === 'server/firewall' ? ok({ pos: 1 }) : undefined),
      (r) =>
        path(r) === 'server/backup' && r.method === 'GET'
          ? ok({ backups: [{ volid: 'local:vzdump-1', size: '10.50' }] })
          : undefined,
      (r) => (path(r) === 'server/backup' ? ok({}) : undefined),
      (r) =>
        path(r) === 'server/os'
          ? ok([
              {
                id: 'x',
                name: 'Debian 12',
                proxmoxId: 'debian-12',
                type: 'os',
                group: 'Debian',
                minDisk: 10,
              },
            ])
          : undefined,
      (r) =>
        path(r) === 'server/reinstall'
          ? ok({ osName: 'debian-12', password: 'Re-Pass-123' })
          : undefined,
      (r) => (path(r) === 'server/passwd' ? ok({}) : undefined),
    ]);
    const service = svc();
    expect(await skrimeServer.loginUrl?.(ctx, service)).toBe('https://novnc.eu/vnc.html#token=abc');
    expect(await extra(skrimeServer, 'console').run(ctx, service, {})).toEqual({
      url: 'https://novnc.eu/vnc.html#token=abc',
    });
    expect(await extra(skrimeServer, 'network').run(ctx, service, {})).toEqual({
      ipv4: [
        {
          ipAddress: '203.0.113.7/24',
          gateway: '203.0.113.1',
          hostname: 'vps.example',
          zone: null,
        },
      ],
      ipv6: [
        { ipAddress: 'fe80::/64', gateway: 'fe80::', hostname: 'vps.example', zone: 'fe80::/64' },
      ],
    });
    const rdns = extra(skrimeServer, 'rdns.set');
    await rdns.run(
      ctx,
      service,
      rdns.paramsSchema?.parse({ ipAddress: '203.0.113.7', hostname: 'mail.example.' }) as Record<
        string,
        unknown
      >,
    );
    expect(calls.at(-1)?.json).toEqual({
      productId: PRODUCT,
      ipAddress: '203.0.113.7',
      hostname: 'mail.example',
    });
    await extra(skrimeServer, 'rdns.delete').run(ctx, service, { ipAddress: 'fe80::' });
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      json: { productId: PRODUCT, ipAddress: 'fe80::' },
    });
    expect(await extra(skrimeServer, 'firewall.list').run(ctx, service, {})).toEqual({
      rules: [{ pos: 0, type: 'in', action: 'ACCEPT', protocol: 'tcp', destinationPort: '22' }],
    });
    const fwCreate = extra(skrimeServer, 'firewall.create');
    const rule = fwCreate.paramsSchema?.parse({
      rule: { type: 'in', action: 'DROP', protocol: 'udp', destinationPort: '53' },
    }) as Record<string, unknown>;
    expect(await fwCreate.run(ctx, service, rule)).toEqual({ pos: 1 });
    expect(calls.at(-1)?.json).toEqual({
      productId: PRODUCT,
      action: 'create',
      rule: { type: 'in', action: 'DROP', enable: 1, protocol: 'udp', destinationPort: '53' },
    });
    await extra(skrimeServer, 'firewall.move').run(ctx, service, { oldPos: 1, pos: 0 });
    expect(calls.at(-1)?.json).toEqual({ productId: PRODUCT, action: 'move', oldPos: 1, pos: 0 });
    await extra(skrimeServer, 'firewall.delete').run(ctx, service, { pos: 0 });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', json: { productId: PRODUCT, pos: 0 } });
    expect(await extra(skrimeServer, 'backup.list').run(ctx, service, {})).toEqual({
      backups: [{ volid: 'local:vzdump-1', size: '10.50' }],
    });
    await extra(skrimeServer, 'backup.restore').run(ctx, service, { volid: 'local:vzdump-1' });
    expect(calls.at(-1)?.json).toEqual({ productId: PRODUCT, volid: 'local:vzdump-1' });
    expect(await extra(skrimeServer, 'os.list').run(ctx, service, {})).toEqual({
      images: [
        { id: 'debian-12', name: 'Debian 12', extra: { group: 'Debian', type: 'os', minDisk: 10 } },
      ],
    });
    expect(
      await extra(skrimeServer, 'reinstall').run(ctx, service, {
        osName: 'debian-12',
        password: 'Re-Pass-123',
      }),
    ).toEqual({ osName: 'debian-12', newPassword: 'Re-Pass-123' });
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      json: { productId: PRODUCT, osName: 'debian-12', password: 'Re-Pass-123' },
    });
    await skrimeServer.changePassword?.(ctx, service, 'Root-New-1');
    expect(calls.at(-1)?.json).toEqual({ productId: PRODUCT, password: 'Root-New-1' });
  });

  it('lists plans and images, validates params and rejects unprovisioned services', async () => {
    const { ctx } = srv([
      (r) =>
        path(r) === 'server/pricelist'
          ? ok([
              {
                id: PLAN,
                productInfo: { cores: 1, memory: 1024, disk: 20, type: 'epyc' },
                finalRenewPrice: '0.99',
              },
            ])
          : undefined,
      (r) =>
        path(r) === 'server/os'
          ? ok([{ name: 'Ubuntu 24.04', proxmoxId: 'ubuntu-24' }])
          : undefined,
    ]);
    expect(await skrimeServer.listRemoteOptions?.(ctx, makeServer(), 'plan')).toEqual([
      {
        id: PLAN,
        name: '1 vCPU · 1 GB RAM · 20 GB · EPYC – € 0.99/mo',
        extra: { priceEur: 0.99, cores: 1, memoryMb: 1024, diskGb: 20, type: 'epyc' },
      },
    ]);
    expect(await skrimeServer.listRemoteOptions?.(ctx, makeServer(), 'image')).toEqual([
      { id: 'ubuntu-24', name: 'Ubuntu 24.04', extra: { group: null, type: null, minDisk: null } },
    ]);
    expect(
      extra(skrimeServer, 'firewall.create').paramsSchema?.safeParse({
        rule: { type: 'sideways', action: 'ACCEPT' },
      }).success,
    ).toBe(false);
    await expect(skrimeServer.power?.(ctx, makeService(), 'start')).rejects.toMatchObject({
      code: 'not_provisioned',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { asList, normaliseStatus, SkrimeProvisionError, toRemoteOption } from './client.js';
import { reinstallSkrimeServer, skrimeServer, skrimeWebspace } from './index.js';
import {
  ctxWith,
  expectCall,
  fakeFetch,
  json,
  makeServer,
  makeService,
  text,
} from './test-utils.js';

const creds = { apiKey: 'sk-test-api-key-1234567890' };
const ok = (data: unknown) => json({ state: 'success', response: 'OK', data });
const fail = (response: string, status = 200) => json({ state: 'error', response }, status);
const webCfg = skrimeWebspace.configSchema.parse({ package: 'web-m' });
const srvCfg = skrimeServer.configSchema.parse({ plan: 'kvm-2', image: 'debian-12' });
const BASE = 'https://skrime.eu/api/';

function web(routes: Parameters<typeof fakeFetch>[0], config = webCfg) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(config, creds, f.fetch) };
}
function srv(routes: Parameters<typeof fakeFetch>[0], config = srvCfg) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(config, creds, f.fetch) };
}
const path = (r: { url: string }) => r.url.replace(BASE, '').split('?')[0];

describe('helpers', () => {
  it('normalises status spellings and list shapes', () => {
    expect(normaliseStatus('Aktiv')).toBe('active');
    expect(normaliseStatus('installing')).toBe('pending');
    expect(normaliseStatus('gekündigt')).toBe('cancelled');
    expect(normaliseStatus(undefined)).toBe('unknown');
    expect(asList([{ id: 'a' }, null])).toEqual([{ id: 'a' }]);
    expect(asList({ 'web-s': { name: 'Web S', price: 2.99 } })).toEqual([
      { id: 'web-s', name: 'Web S', price: 2.99 },
    ]);
    expect(
      toRemoteOption({ id: 'kvm-2', name: 'KVM 2', price: '4.99', cpu: 2, ram: 4096 }),
    ).toEqual({
      id: 'kvm-2',
      name: 'KVM 2',
      extra: { priceEur: 4.99, cpu: 2, ram: 4096 },
    });
  });

  it('declares schemas and credentials', () => {
    expect(skrimeWebspace.id).toBe('skrime_webspace');
    expect(skrimeServer.id).toBe('skrime_server');
    expect(skrimeWebspace.configSchema.safeParse({}).success).toBe(false);
    expect(skrimeServer.configSchema.safeParse({ plan: 'x' }).success).toBe(false);
    expect(skrimeWebspace.credentialsSchema?.safeParse({ apiKey: 'short' }).success).toBe(false);
    expect(skrimeWebspace.credentialsSchema?.parse(creds)).toMatchObject({
      baseUrl: 'https://skrime.eu/api',
      timeoutMs: 30_000,
    });
  });
});

describe('skrime webspace', () => {
  it('orders a webspace, reads panel details back and returns module data', async () => {
    const { ctx, calls } = web([
      (r) => (path(r) === 'webspace/order' ? ok({ id: 1234, status: 'pending' }) : undefined),
      (r) =>
        path(r) === 'webspace/single'
          ? ok({
              id: 1234,
              status: 'active',
              domain: 'example-client.test',
              price: '4.99',
              panel: { url: 'https://plesk.skrime.eu:8443', username: 'u1234' },
            })
          : undefined,
    ]);
    const res = await skrimeWebspace.create(ctx, makeService({ password: 'Secret-Pass-1' }));
    const order = expectCall(calls, 0, 'https://skrime.eu/api/webspace/order');
    expect(order.method).toBe('POST');
    expect(order.headers.authorization).toBe('Bearer sk-test-api-key-1234567890');
    expect(order.json).toEqual({ package: 'web-m', domain: 'example-client.test', tos: true });
    expect(calls[1]?.url).toBe('https://skrime.eu/api/webspace/single?id=1234');
    expect(res).toEqual({
      username: 'u1234',
      password: 'Secret-Pass-1',
      message: 'Skrime webspace 1234 ordered for example-client.test',
      moduleData: {
        productId: '1234',
        package: 'web-m',
        domain: 'example-client.test',
        panelUrl: 'https://plesk.skrime.eu:8443',
        username: 'u1234',
        costAmount: 499,
        costCurrency: 'EUR',
      },
    });
  });

  it('sets its own password when Skrime does not return one and the service has none', async () => {
    const { ctx, calls } = web([
      (r) =>
        path(r) === 'webspace/order'
          ? ok({ id: 'ws-9', panel: { url: 'https://p', username: 'u9' } })
          : undefined,
      (r) => (path(r) === 'webspace/password' ? ok({}) : undefined),
    ]);
    const res = await skrimeWebspace.create(ctx, makeService());
    expect(calls).toHaveLength(2);
    expect((calls[1]?.json as { id: string } | undefined)?.id).toBe('ws-9');
    expect(res.password).toMatch(/.{12,}/);
    expect((calls[1]?.json as { password: string } | undefined)?.password).toBe(res.password);
  });

  it('requires a domain and surfaces Skrime errors', async () => {
    const { ctx } = web([]);
    await expect(skrimeWebspace.create(ctx, makeService({ domain: null }))).rejects.toThrow(
      /domain/,
    );
    const { ctx: ctx2 } = web([
      (r) => (path(r) === 'webspace/order' ? fail('Insufficient balance') : undefined),
    ]);
    await expect(skrimeWebspace.create(ctx2, makeService())).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('suspends by rotating the panel password and unsuspends with the stored one', async () => {
    const { ctx, calls } = web([(r) => (path(r) === 'webspace/password' ? ok({}) : undefined)]);
    const service = makeService({
      moduleData: { productId: 'ws-1', package: 'web-m', domain: 'd' },
      password: 'Known-1234',
    });
    await skrimeWebspace.suspend(ctx, service);
    await skrimeWebspace.unsuspend(ctx, service);
    expect(calls).toHaveLength(2);
    expect((calls[0]?.json as { password: string } | undefined)?.password).not.toBe('Known-1234');
    expect(calls[1]?.json).toEqual({ id: 'ws-1', password: 'Known-1234' });
    const { ctx: none, calls: noCalls } = web(
      [],
      skrimeWebspace.configSchema.parse({ package: 'web-m', suspendMode: 'none' }),
    );
    await skrimeWebspace.suspend(none, service);
    expect(noCalls).toHaveLength(0);
  });

  it('terminates (cancel at Skrime), tolerating an already removed product', async () => {
    const { ctx, calls } = web([(r) => (path(r) === 'webspace/cancel' ? ok({}) : undefined)]);
    const service = makeService({
      moduleData: { productId: 'ws-1', package: 'web-m', domain: 'd' },
    });
    await skrimeWebspace.terminate(ctx, service);
    expect(calls[0]?.json).toEqual({ id: 'ws-1' });
    expect(service.moduleData.cancelledAt).toMatch(/^\d{4}-/);
    const { ctx: gone } = web([
      (r) => (path(r) === 'webspace/cancel' ? fail('No product found', 404) : undefined),
    ]);
    await expect(skrimeWebspace.terminate(gone, service)).resolves.toBeUndefined();
    await expect(skrimeWebspace.terminate(ctx, makeService())).rejects.toBeInstanceOf(
      SkrimeProvisionError,
    );
  });

  it('changes package, password, reports usage and resolves the login url', async () => {
    const { ctx, calls } = web([
      (r) => (path(r) === 'webspace/upgrade' ? ok({}) : undefined),
      (r) => (path(r) === 'webspace/password' ? ok({}) : undefined),
      (r) =>
        path(r) === 'webspace/single'
          ? ok({ status: 'active', diskUsed: 512, disk: 10240, trafficUsed: 1000, traffic: 100000 })
          : undefined,
      (r) =>
        path(r) === 'webspace/login'
          ? ok({ url: 'https://plesk.skrime.eu/login?token=abc' })
          : undefined,
    ]);
    const service = makeService({
      moduleData: { productId: 'ws-1', package: 'web-m', domain: 'd', panelUrl: 'https://plesk' },
    });
    await skrimeWebspace.changePackage?.(ctx, service, {
      ...service.product,
      moduleConfig: { package: 'web-l' },
    });
    expect(calls[0]?.json).toEqual({ id: 'ws-1', package: 'web-l' });
    expect(service.moduleData.package).toBe('web-l');
    await skrimeWebspace.changePassword?.(ctx, service, 'New-Pass-123');
    expect(calls[1]?.json).toEqual({ id: 'ws-1', password: 'New-Pass-123' });
    expect(await skrimeWebspace.getUsage?.(ctx, service)).toEqual({
      diskUsedMb: 512,
      diskLimitMb: 10240,
      bandwidthUsedMb: 1000,
      bandwidthLimitMb: 100000,
      extra: { status: 'active' },
    });
    expect(await skrimeWebspace.loginUrl?.(ctx, service)).toBe(
      'https://plesk.skrime.eu/login?token=abc',
    );
    const { ctx: noLogin } = web([
      (r) => (path(r) === 'webspace/login' ? fail('Not found', 404) : undefined),
    ]);
    expect(await skrimeWebspace.loginUrl?.(noLogin, service)).toBe('https://plesk');
  });

  it('lists packages and tests the connection', async () => {
    const { ctx } = web([
      (r) =>
        path(r) === 'webspace/pricelist'
          ? ok([{ id: 'web-s', name: 'Web S', price: 2.99 }])
          : undefined,
      (r) => (path(r) === 'product/all' ? ok([]) : undefined),
    ]);
    expect(await skrimeWebspace.listRemoteOptions?.(ctx, makeServer(), 'package')).toEqual([
      { id: 'web-s', name: 'Web S', extra: { priceEur: 2.99 } },
    ]);
    expect(await skrimeWebspace.listRemoteOptions?.(ctx, makeServer(), 'other')).toEqual([]);
    expect(await skrimeWebspace.testConnection(ctx, makeServer())).toEqual({
      ok: true,
      message: 'Skrime API key accepted',
    });
    const { ctx: bad } = web([() => text('Unauthorized', 401)]);
    expect(await skrimeWebspace.testConnection(bad, makeServer())).toMatchObject({
      ok: false,
      message: expect.stringContaining('API key'),
    });
  });
});

describe('skrime server', () => {
  const svc = (over: Record<string, unknown> = {}) =>
    makeService({
      domain: null,
      moduleData: {
        productId: 'srv-7',
        plan: 'kvm-2',
        image: 'debian-12',
        hostname: 'vps-00000a',
        ip: '203.0.113.7',
      },
      ...over,
    });

  it('orders a server with a generated hostname and reads the ip back', async () => {
    const { ctx, calls } = srv([
      (r) =>
        path(r) === 'server/order'
          ? ok({ id: 'srv-7', status: 'installing', price: 4.99 })
          : undefined,
      (r) =>
        path(r) === 'server/single'
          ? ok({ id: 'srv-7', status: 'active', ip: '203.0.113.7', power: 'running' })
          : undefined,
    ]);
    const res = await skrimeServer.create(
      ctx,
      makeService({ domain: null, password: 'Root-Pass-1' }),
    );
    const order = expectCall(calls, 0, 'https://skrime.eu/api/server/order');
    expect(order.json).toEqual({
      plan: 'kvm-2',
      image: 'debian-12',
      hostname: 'vps-0000000a',
      password: 'Root-Pass-1',
      tos: true,
    });
    expect(res).toEqual({
      username: 'root',
      password: 'Root-Pass-1',
      ipAddress: '203.0.113.7',
      message: 'Skrime server srv-7 ordered (vps-0000000a, 203.0.113.7)',
      moduleData: {
        productId: 'srv-7',
        plan: 'kvm-2',
        image: 'debian-12',
        hostname: 'vps-0000000a',
        ip: '203.0.113.7',
        costAmount: 499,
        costCurrency: 'EUR',
      },
    });
  });

  it('uses the service domain as hostname and keeps the password Skrime returns', async () => {
    const { ctx, calls } = srv([
      (r) =>
        path(r) === 'server/order'
          ? ok({ id: 9, ip: '203.0.113.9', password: 'FromSkrime1' })
          : undefined,
    ]);
    const res = await skrimeServer.create(ctx, makeService({ domain: 'Node1.Example.Test' }));
    expect(calls).toHaveLength(1);
    expect((calls[0]?.json as { hostname: string } | undefined)?.hostname).toBe(
      'node1.example.test',
    );
    expect(res.password).toBe('FromSkrime1');
    expect(res.moduleData.ip).toBe('203.0.113.9');
  });

  it('maps power actions, suspend/unsuspend to power, and terminate to cancel', async () => {
    const { ctx, calls } = srv([
      (r) => (path(r) === 'server/power' ? ok({}) : undefined),
      (r) => (path(r) === 'server/cancel' ? ok({}) : undefined),
    ]);
    const service = svc();
    await skrimeServer.power?.(ctx, service, 'reboot');
    await skrimeServer.power?.(ctx, service, 'shutdown');
    await skrimeServer.suspend(ctx, service);
    await skrimeServer.unsuspend(ctx, service);
    await skrimeServer.terminate(ctx, service);
    expect(calls.map((c) => c.json)).toEqual([
      { id: 'srv-7', action: 'restart' },
      { id: 'srv-7', action: 'shutdown' },
      { id: 'srv-7', action: 'stop' },
      { id: 'srv-7', action: 'start' },
      { id: 'srv-7' },
    ]);
    expect(service.moduleData.cancelledAt).toBeDefined();
  });

  it('reports usage with the power state and refreshes the ip', async () => {
    const { ctx } = srv([
      (r) =>
        path(r) === 'server/single'
          ? ok({
              status: 'active',
              power: 'Running',
              ip: '203.0.113.8',
              cpu: 2,
              ram: 4096,
              disk: 80,
              trafficUsed: 10,
              traffic: 20000,
            })
          : undefined,
    ]);
    const service = svc();
    expect(await skrimeServer.getUsage?.(ctx, service)).toEqual({
      bandwidthUsedMb: 10,
      bandwidthLimitMb: 20000,
      diskLimitMb: 81920,
      extra: { status: 'running', cpu: 2, ramMb: 4096, diskGb: 80, ip: '203.0.113.8' },
    });
    expect(service.moduleData.ip).toBe('203.0.113.8');
  });

  it('changes plan, resets the root password, reinstalls and lists plans/images', async () => {
    const { ctx, calls } = srv([
      (r) => (path(r) === 'server/upgrade' ? ok({}) : undefined),
      (r) => (path(r) === 'server/password' ? ok({}) : undefined),
      (r) => (path(r) === 'server/reinstall' ? ok({}) : undefined),
      (r) =>
        path(r) === 'server/pricelist'
          ? ok({ 'kvm-1': { name: 'KVM 1', price: 0.99 } })
          : undefined,
      (r) =>
        path(r) === 'server/images' ? ok([{ id: 'ubuntu-24', name: 'Ubuntu 24.04' }]) : undefined,
    ]);
    const service = svc();
    await skrimeServer.changePackage?.(ctx, service, {
      ...service.product,
      moduleConfig: { plan: 'kvm-4', image: 'debian-12' },
    });
    expect(calls[0]?.json).toEqual({ id: 'srv-7', plan: 'kvm-4' });
    await skrimeServer.changePassword?.(ctx, service, 'Root-New-1');
    expect(calls[1]?.json).toEqual({ id: 'srv-7', password: 'Root-New-1' });
    const re = await reinstallSkrimeServer(ctx, service, 'ubuntu-24');
    expect(calls[2]?.json).toEqual({ id: 'srv-7', image: 'ubuntu-24', password: re.password });
    expect(await skrimeServer.listRemoteOptions?.(ctx, makeServer(), 'plan')).toEqual([
      { id: 'kvm-1', name: 'KVM 1', extra: { priceEur: 0.99 } },
    ]);
    expect(await skrimeServer.listRemoteOptions?.(ctx, makeServer(), 'image')).toEqual([
      { id: 'ubuntu-24', name: 'Ubuntu 24.04', extra: {} },
    ]);
  });

  it('rejects actions on an unprovisioned service', async () => {
    const { ctx } = srv([]);
    await expect(skrimeServer.power?.(ctx, makeService(), 'start')).rejects.toMatchObject({
      code: 'not_provisioned',
    });
  });
});

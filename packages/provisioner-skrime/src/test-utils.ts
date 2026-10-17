import {
  createModuleContext,
  type ModuleContext,
  type ServerDTO,
  type ServiceDTO,
} from '@provisia/module-sdk';
import { expect } from 'vitest';

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  params: URLSearchParams;
  json: unknown;
}

export type Route = (req: Recorded) => Response | Promise<Response> | undefined;

/** Minimal in-memory HTTP mock: routes are tried in order; the first one returning a Response wins. */
export function fakeFetch(routes: Route[]) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let json: unknown;
    try {
      json = body ? JSON.parse(body) : undefined;
    } catch {
      json = undefined;
    }
    const rec: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
      params: new URLSearchParams(body),
      json,
    };
    calls.push(rec);
    for (const route of routes) {
      const res = await route(rec);
      if (res) return res;
    }
    throw new Error(`unexpected request ${rec.method} ${url}`);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
export const text = (data: string, status = 200, contentType = 'text/plain') =>
  new Response(data, { status, headers: { 'content-type': contentType } });

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function ctxWith<TConfig>(
  config: TConfig,
  credentials: Record<string, unknown>,
  fetchImpl: typeof fetch,
): ModuleContext<TConfig> {
  return createModuleContext({
    config,
    credentials,
    logger: silentLogger,
    appUrl: 'http://api.test',
    webUrl: 'http://web.test',
    fetch: fetchImpl,
  });
}

export function makeServer(over: Partial<ServerDTO> = {}): ServerDTO {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    name: 'srv1',
    module: 'skrime_webspace',
    hostname: 'skrime.eu',
    ipAddress: '203.0.113.10',
    port: null,
    secure: true,
    nameservers: ['ns1.example.test', 'ns2.example.test'],
    groupName: 'skrime',
    maxAccounts: 100,
    active: true,
    notes: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

export function makeService(
  over: Partial<ServiceDTO> = {},
  moduleConfig: Record<string, unknown> = {},
): ServiceDTO {
  const server = over.server === undefined ? makeServer() : over.server;
  return {
    id: '019a0000-0000-7000-8000-00000000000a',
    clientId: '019a0000-0000-7000-8000-00000000000b',
    productId: '019a0000-0000-7000-8000-00000000000c',
    serverId: server?.id ?? null,
    status: 'pending',
    billingCycle: 'monthly',
    recurringAmount: 999,
    currency: 'EUR',
    registrationDate: '2026-01-01',
    nextDueDate: '2026-02-01',
    suspendedAt: null,
    suspendReason: null,
    terminatedAt: null,
    cancellationRequestedAt: null,
    domain: 'example-client.test',
    username: null,
    moduleData: {},
    notes: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    product: {
      id: '019a0000-0000-7000-8000-00000000000c',
      groupId: '019a0000-0000-7000-8000-00000000000d',
      name: 'Starter',
      slug: 'starter',
      description: null,
      type: 'hosting',
      module: 'skrime_webspace',
      moduleConfig,
      serverGroup: 'skrime',
      taxable: true,
      requiresDomain: true,
      stockControl: false,
      stock: 0,
      hidden: false,
      sortOrder: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    client: {
      id: '019a0000-0000-7000-8000-00000000000b',
      email: 'client@example.test',
      name: 'Jane Client',
      companyName: 'Client BV',
      country: 'NL',
    },
    ...over,
    server,
  };
}

/** Assert helper: the n-th recorded call matches. */
export function expectCall(calls: Recorded[], index: number, urlPart: string) {
  const c = calls[index];
  expect(c, `call #${index} missing`).toBeDefined();
  expect((c as Recorded).url).toContain(urlPart);
  return c as Recorded;
}

import { createModuleContext, type DomainDTO, type RegisterRequest } from '@provisia/module-sdk';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import skrime, { createClient, SkrimeError, skrimeConfigSchema, skrimeExtras } from './index.js';

const BASE = 'https://skrime.test/api';
const server = setupServer();
const requests: Array<{ method: string; url: string; body: unknown; auth: string | null }> = [];

beforeAll(() => {
  server.listen();
  server.events.on('request:start', async ({ request }) => {
    const clone = request.clone();
    const text = await clone.text();
    requests.push({
      method: request.method,
      url: request.url,
      body: text ? JSON.parse(text) : null,
      auth: request.headers.get('authorization'),
    });
  });
});
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => server.close());

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function ctx(overrides: Partial<ReturnType<typeof skrimeConfigSchema.parse>> = {}) {
  return createModuleContext({
    config: skrimeConfigSchema.parse({ apiKey: 'test-key', baseUrl: BASE, ...overrides }),
    logger,
    appUrl: 'http://localhost:3001',
    webUrl: 'http://localhost:3000',
  });
}

const ok = (data: unknown) => HttpResponse.json({ state: 'success', response: 'OK', data });
const fail = (response: string, status = 200) =>
  HttpResponse.json({ state: 'error', response }, { status });

const domain: DomainDTO = {
  id: '018f0000-0000-7000-8000-000000000001',
  clientId: '018f0000-0000-7000-8000-000000000002',
  name: 'example.nl',
  tld: 'nl',
  registrarModule: 'skrime',
  status: 'active',
  registrarStatus: null,
  registrationDate: '2025-01-01',
  expiryDate: '2026-01-01',
  nextDueDate: '2026-01-01',
  registrationPeriod: 1,
  recurringAmount: 990,
  currency: 'EUR',
  nameservers: [],
  autoRenew: true,
  locked: true,
  idProtection: false,
  contacts: null,
  registrantContactId: null,
  adminContactId: null,
  techContactId: null,
  billingContactId: null,
  moduleData: {},
  lastError: null,
  lastSyncedAt: null,
  expiryNoticesSent: [],
  autoRenewInvoicedAt: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const registerReq: RegisterRequest = {
  domain: 'Example.nl',
  years: 1,
  nameservers: ['ns1.provisia.test', 'ns2.provisia.test'],
  contacts: {
    registrant: {
      firstName: 'Jan',
      lastName: 'Jansen',
      organization: 'Müller (Holding) GmbH',
      email: 'jan@example.nl',
      phone: '+31.612345678',
      address1: 'Hauptstraße 12a',
      city: 'Amsterdam',
      postalCode: '1011AB',
      country: 'nl',
    },
  },
};

describe('config', () => {
  it('requires an api key and defaults the rest', () => {
    expect(() => skrimeConfigSchema.parse({})).toThrow();
    const c = skrimeConfigSchema.parse({ apiKey: 'k' });
    expect(c).toMatchObject({
      sandbox: false,
      baseUrl: 'https://skrime.eu/api',
      defaultNameservers: [],
    });
  });
});

describe('checkAvailability', () => {
  it('posts one check per domain and maps the result', async () => {
    server.use(
      http.post(`${BASE}/domain/check`, async ({ request }) => {
        const { domain } = (await request.json()) as { domain: string };
        return ok({
          available: domain === 'free.nl',
          premium: domain === 'taken.com',
          price: domain === 'taken.com' ? '99.5' : undefined,
        });
      }),
    );
    const res = await skrime.checkAvailability(ctx(), ['Free.nl', 'taken.com']);
    expect(res).toEqual([
      { domain: 'free.nl', available: true },
      {
        domain: 'taken.com',
        available: false,
        premium: true,
        price: { amount: 9950, currency: 'EUR' },
      },
    ]);
    expect(requests[0]?.auth).toBe('Bearer test-key');
  });

  it('never fails the batch: errors become unavailable + reason', async () => {
    server.use(
      http.post(`${BASE}/domain/check`, async ({ request }) => {
        const { domain } = (await request.json()) as { domain: string };
        return domain === 'bad.nl' ? fail('Invalid domain') : ok({ available: true });
      }),
    );
    const res = await skrime.checkAvailability(ctx(), ['bad.nl', 'good.nl']);
    expect(res[0]).toMatchObject({
      domain: 'bad.nl',
      available: false,
      reason: expect.stringContaining('Invalid domain'),
    });
    expect(res[1]).toEqual({ domain: 'good.nl', available: true });
  });
});

describe('register / transfer', () => {
  it('builds the order payload like the WHMCS module', async () => {
    server.use(http.post(`${BASE}/domain/order`, () => ok({})));
    const res = await skrime.register(ctx(), registerReq);
    expect(res.status).toBe('pending');
    expect(requests[0]?.body).toEqual({
      domain: 'example.nl',
      authCode: '',
      tos: true,
      cancellation: true,
      contact: {
        company: 'Mueller Holding GmbH',
        firstname: 'Jan',
        lastname: 'Jansen',
        street: 'Hauptstraße',
        number: '12a',
        postcode: '1011AB',
        city: 'Amsterdam',
        state: '',
        country: 'NL',
        email: 'jan@example.nl',
        phone: '+31.612345678',
        nameserver: ['ns1.provisia.test', 'ns2.provisia.test'],
      },
    });
  });

  it('returns completed with expiry when the order response carries expireAt', async () => {
    server.use(http.post(`${BASE}/domain/order`, () => ok({ expireAt: '2027-05-01T00:00:00Z' })));
    const res = await skrime.register(ctx(), registerReq);
    expect(res).toMatchObject({ status: 'completed', expiryDate: '2027-05-01' });
  });

  it('uses default nameservers from config when none are given', async () => {
    server.use(http.post(`${BASE}/domain/order`, () => ok({})));
    await skrime.register(ctx({ defaultNameservers: ['ns1.default.test'] }), {
      ...registerReq,
      nameservers: [],
    });
    expect(requests[0]?.body).toMatchObject({ contact: { nameserver: ['ns1.default.test'] } });
  });

  it('transfer sends the auth code and requires it', async () => {
    server.use(http.post(`${BASE}/domain/order`, () => ok({})));
    await skrime.transfer(ctx(), { ...registerReq, eppCode: 'SECRET-1' });
    expect(requests[0]?.body).toMatchObject({ authCode: 'SECRET-1' });
    await expect(skrime.transfer(ctx(), { ...registerReq, eppCode: '' })).rejects.toMatchObject({
      code: 'invalid_auth_code',
    });
  });

  it('maps domain-unavailable and insufficient-funds errors', async () => {
    server.use(http.post(`${BASE}/domain/order`, () => fail('Domain is not available')));
    await expect(skrime.register(ctx(), registerReq)).rejects.toMatchObject({
      code: 'domain_unavailable',
      retryable: false,
    });
    server.use(http.post(`${BASE}/domain/order`, () => fail('Insufficient balance')));
    await expect(skrime.register(ctx(), registerReq)).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('sandbox mode does not send mutating requests', async () => {
    const res = await skrime.register(ctx({ sandbox: true }), registerReq);
    expect(res).toMatchObject({ status: 'pending', moduleData: { sandbox: true } });
    expect(requests).toHaveLength(0);
  });
});

describe('renew', () => {
  it('posts renew and reads back the expiry', async () => {
    server.use(
      http.post(`${BASE}/domain/renew`, () => ok({})),
      http.get(`${BASE}/domain/single`, () => ok({ expireAt: '2027-01-01 00:00:00' })),
    );
    const res = await skrime.renew(ctx(), domain, 1);
    expect(res).toMatchObject({ status: 'completed', expiryDate: '2027-01-01' });
    expect(requests[0]?.body).toEqual({ domain: 'example.nl' });
    expect(requests[1]?.url).toBe(`${BASE}/domain/single?domain=example.nl`);
  });

  it('returns pending when the read-back fails', async () => {
    server.use(
      http.post(`${BASE}/domain/renew`, () => ok({})),
      http.get(`${BASE}/domain/single`, () => HttpResponse.text('boom', { status: 500 })),
    );
    const res = await skrime.renew(ctx(), domain, 1);
    expect(res.status).toBe('pending');
  });
});

describe('getInfo', () => {
  it('maps expireAt, nameservers and status', async () => {
    server.use(
      http.get(`${BASE}/domain/single`, () =>
        ok({ expireAt: '2999-02-03T10:00:00.000000Z', whoisPrivacy: true }),
      ),
      http.get(`${BASE}/domain/nameserver`, () => ok({ nameserver: ['ns1.a.test', 'ns2.a.test'] })),
    );
    const info = await skrime.getInfo(ctx(), domain);
    expect(info).toEqual({
      status: 'active',
      expiryDate: '2999-02-03',
      nameservers: ['ns1.a.test', 'ns2.a.test'],
      locked: null,
      idProtection: true,
      autoRenew: null,
    });
  });

  it('reports expired when expireAt is in the past', async () => {
    server.use(
      http.get(`${BASE}/domain/single`, () =>
        ok({ expireAt: '2020-01-01', nameserver: ['ns1.x'] }),
      ),
    );
    const info = await skrime.getInfo(ctx(), domain);
    expect(info.status).toBe('expired');
    expect(requests).toHaveLength(1);
  });

  it('returns unknown (not cancelled) on "No product found"', async () => {
    server.use(http.get(`${BASE}/domain/single`, () => fail('No product found')));
    const info = await skrime.getInfo(ctx(), domain);
    expect(info).toMatchObject({ status: 'unknown', expiryDate: null });
  });

  it('returns unknown on HTTP 404', async () => {
    server.use(http.get(`${BASE}/domain/single`, () => HttpResponse.text('', { status: 404 })));
    expect((await skrime.getInfo(ctx(), domain)).status).toBe('unknown');
  });
});

describe('nameservers, epp code, contacts', () => {
  it('setNameservers posts the list', async () => {
    server.use(http.post(`${BASE}/domain/nameserver`, () => ok({})));
    await skrime.setNameservers(ctx(), domain, ['NS1.X.test', 'ns2.x.test']);
    expect(requests[0]?.body).toEqual({
      domain: 'example.nl',
      nameserver: ['ns1.x.test', 'ns2.x.test'],
    });
  });

  it('getEppCode returns data.authcode and fails on empty', async () => {
    server.use(http.get(`${BASE}/domain/authcode`, () => ok({ authcode: 'ABC-123' })));
    expect(await skrime.getEppCode(ctx(), domain)).toBe('ABC-123');
    server.use(http.get(`${BASE}/domain/authcode`, () => ok({})));
    await expect(skrime.getEppCode(ctx(), domain)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('setContacts posts the registrant as skrime contact', async () => {
    server.use(http.post(`${BASE}/domain/contact`, () => ok({})));
    await skrime.setContacts?.(ctx(), domain, registerReq.contacts);
    expect(requests[0]?.body).toMatchObject({
      domain: 'example.nl',
      contact: { firstname: 'Jan', street: 'Hauptstraße', number: '12a' },
    });
  });

  it('getContacts maps the flat skrime contact back', async () => {
    server.use(
      http.get(`${BASE}/domain/contact`, () =>
        ok({
          contact: {
            firstname: 'A',
            lastname: 'B',
            street: 'Dam',
            number: '1',
            city: 'Amsterdam',
            postcode: '1000',
            country: 'nl',
            email: 'a@b.nl',
            phone: '+31',
            company: 'ACME',
          },
        }),
      ),
    );
    const c = await skrimeExtras.getContacts(ctx(), domain);
    expect(c.registrant).toMatchObject({
      firstName: 'A',
      address1: 'Dam 1',
      country: 'NL',
      organization: 'ACME',
    });
  });

  it('has no setLock (unsupported by Skrime)', () => {
    expect(skrime.setLock).toBeUndefined();
  });
});

describe('getTldPricing', () => {
  it('converts euro floats to cents and strips dots', async () => {
    server.use(
      http.get(`${BASE}/domain/pricelist`, () =>
        ok([
          { tld: '.de', create: 4.9, renew: '4.90', transfer: 4.9, restore: 49 },
          { tld: 'nl', create: '7,50', renew: 7.5, transfer: 0 },
        ]),
      ),
    );
    const prices = await skrime.getTldPricing?.(ctx());
    expect(prices).toEqual([
      {
        tld: 'de',
        currency: 'EUR',
        register: 490,
        renew: 490,
        transfer: 490,
        restore: 4900,
        minYears: 1,
        maxYears: 10,
      },
      {
        tld: 'nl',
        currency: 'EUR',
        register: 750,
        renew: 750,
        transfer: 0,
        restore: 0,
        minYears: 1,
        maxYears: 10,
      },
    ]);
  });
});

describe('dns extras', () => {
  it('reads and writes the zone', async () => {
    server.use(
      http.get(`${BASE}/domain/dns`, () =>
        ok({ records: [{ name: '@', type: 'A', data: '1.2.3.4' }] }),
      ),
      http.post(`${BASE}/domain/dns`, () => ok({})),
    );
    expect(await skrimeExtras.getDns(ctx(), domain)).toEqual([
      { name: '@', type: 'A', data: '1.2.3.4' },
    ]);
    await skrimeExtras.setDns(ctx(), domain, [{ name: 'www', type: 'CNAME', data: 'example.nl' }]);
    expect(requests[1]?.body).toEqual({
      domain: 'example.nl',
      records: [{ name: 'www', type: 'CNAME', data: 'example.nl' }],
    });
  });
});

describe('http error handling and retries', () => {
  const fastClient = () => createClient(ctx(), { backoffMs: 0, sleep: async () => {} });

  it('retries 5xx with backoff and then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/domain/pricelist`, () => {
        calls++;
        return calls < 3 ? HttpResponse.text('bad gateway', { status: 502 }) : ok([]);
      }),
    );
    expect(await fastClient().get('domain/pricelist')).toEqual([]);
    expect(calls).toBe(3);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/domain/pricelist`, () => {
        calls++;
        return HttpResponse.json({ state: 'error', response: 'down' }, { status: 503 });
      }),
    );
    await expect(fastClient().get('domain/pricelist')).rejects.toMatchObject({
      code: 'upstream_error',
      httpStatus: 503,
      retryable: true,
    });
    expect(calls).toBe(3);
  });

  it('retries 429 and network errors', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/domain/pricelist`, () => {
        calls++;
        if (calls === 1) return HttpResponse.text('slow down', { status: 429 });
        if (calls === 2) return HttpResponse.error();
        return ok([]);
      }),
    );
    await fastClient().get('domain/pricelist');
    expect(calls).toBe(3);
  });

  it('does not retry 401/403 and maps to auth_failed', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/domain/pricelist`, () => {
        calls++;
        return HttpResponse.json({ message: 'Unauthenticated.' }, { status: 401 });
      }),
    );
    await expect(fastClient().get('domain/pricelist')).rejects.toMatchObject({
      code: 'auth_failed',
      retryable: false,
    });
    expect(calls).toBe(1);
  });

  it('rejects non-JSON 200 responses', async () => {
    server.use(http.get(`${BASE}/domain/pricelist`, () => HttpResponse.text('<html>login</html>')));
    await expect(fastClient().get('domain/pricelist')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends GET parameters as query string and JSON on POST', async () => {
    server.use(
      http.get(`${BASE}/domain/single`, () => ok({})),
      http.post(`${BASE}/domain/renew`, () => ok({})),
    );
    await fastClient().get('domain/single', { domain: 'a.nl' });
    await fastClient().post('domain/renew', { domain: 'a.nl' });
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: `${BASE}/domain/single?domain=a.nl`,
      body: null,
    });
    expect(requests[1]).toMatchObject({ method: 'POST', body: { domain: 'a.nl' } });
  });

  it('SkrimeError carries the raw envelope', async () => {
    server.use(http.post(`${BASE}/domain/renew`, () => fail('Something odd')));
    const err = await fastClient()
      .post<SkrimeError>('domain/renew', {})
      .catch((e: unknown) => e as SkrimeError);
    expect(err).toBeInstanceOf(SkrimeError);
    expect(err.raw).toEqual({ state: 'error', response: 'Something odd' });
  });
});

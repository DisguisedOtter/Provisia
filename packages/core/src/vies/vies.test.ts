import { describe, expect, it, vi } from 'vitest';
import { createFakeViesClient, createViesRestClient, VIES_REST_URL } from './rest.js';
import { isPlausibleNlVat, parseVatNumber, ViesUnavailableError, viesPrefixFor } from './types.js';

function fetchJson(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('VAT number parsing', () => {
  it('normalizes separators and case', () => {
    expect(parseVatNumber('nl 1234.56789.b01')).toEqual({
      countryCode: 'NL',
      number: '123456789B01',
      normalized: 'NL123456789B01',
    });
    expect(parseVatNumber('DE-123 456 789')?.normalized).toBe('DE123456789');
    expect(parseVatNumber('123456789B01', 'NL')?.normalized).toBe('NL123456789B01');
    expect(parseVatNumber('123456789', 'GR')?.countryCode).toBe('EL');
    expect(viesPrefixFor('gr')).toBe('EL');
  });
  it('rejects non-EU and junk', () => {
    expect(parseVatNumber('US123456')).toBeNull();
    expect(parseVatNumber('12')).toBeNull();
    expect(parseVatNumber('123456', 'CH')).toBeNull();
    expect(parseVatNumber('NL1')).toBeNull();
  });
  it('checks the NL mod-97 checksum', () => {
    expect(isPlausibleNlVat('000099998B57')).toBe(true);
    expect(isPlausibleNlVat('123456789B01')).toBe(false);
    expect(isPlausibleNlVat('12345678901')).toBe(false);
  });
});

describe('VIES REST client', () => {
  const now = () => new Date('2026-10-17T10:00:00Z');

  it('posts to the REST endpoint and maps a valid response', async () => {
    const fetch = fetchJson(200, {
      countryCode: 'NL',
      vatNumber: '000099998B57',
      requestDate: '2026-10-17+02:00',
      valid: true,
      name: 'TEST TRADER B.V.',
      address: 'TESTSTRAAT 1\n1234 AB AMSTERDAM',
      requestIdentifier: 'WAPIAAAAY4BObuPe',
    });
    const client = createViesRestClient({
      fetch,
      now,
      requester: { countryCode: 'NL', vatNumber: '000000000B01' },
    });
    const r = await client.checkVat('NL', '000099998B57');
    expect(r).toEqual({
      valid: true,
      countryCode: 'NL',
      vatNumber: '000099998B57',
      name: 'TEST TRADER B.V.',
      address: 'TESTSTRAAT 1 1234 AB AMSTERDAM',
      requestIdentifier: 'WAPIAAAAY4BObuPe',
      checkedAt: now(),
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VIES_REST_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      countryCode: 'NL',
      vatNumber: '000099998B57',
      requesterMemberStateCode: 'NL',
      requesterNumber: '000000000B01',
    });
  });

  it('maps an invalid number (placeholder name/address become null)', async () => {
    const fetch = fetchJson(200, {
      countryCode: 'DE',
      vatNumber: '123',
      valid: false,
      name: '---',
      address: '---',
      userError: 'INVALID',
    });
    const r = await createViesRestClient({ fetch, now }).checkVat('DE', '123');
    expect(r.valid).toBe(false);
    expect(r.name).toBeNull();
    expect(r.address).toBeNull();
  });

  it('treats malformed input errors as invalid, not an outage', async () => {
    const fetch = fetchJson(200, { userError: 'INVALID_INPUT', valid: false });
    const r = await createViesRestClient({ fetch, now }).checkVat('NL', 'ABC');
    expect(r.valid).toBe(false);
  });

  it('throws ViesUnavailableError on member-state outages, 5xx, 429 and network errors', async () => {
    await expect(
      createViesRestClient({ fetch: fetchJson(200, { userError: 'MS_UNAVAILABLE' }) }).checkVat(
        'IT',
        '1',
      ),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    await expect(
      createViesRestClient({
        fetch: fetchJson(200, { errorWrappers: [{ error: 'MS_MAX_CONCURRENT_REQ' }] }),
      }).checkVat('IT', '1'),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    await expect(
      createViesRestClient({ fetch: fetchJson(503, {}) }).checkVat('IT', '1'),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    await expect(
      createViesRestClient({ fetch: fetchJson(429, {}) }).checkVat('IT', '1'),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      createViesRestClient({ fetch: failing }).checkVat('IT', '1'),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    const html = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(createViesRestClient({ fetch: html }).checkVat('IT', '1')).rejects.toBeInstanceOf(
      ViesUnavailableError,
    );
  });

  it('fake client is deterministic', async () => {
    const fake = createFakeViesClient({ NL111: false });
    expect((await fake.checkVat('NL', '123456789B01')).valid).toBe(true);
    expect((await fake.checkVat('NL', '123456789B00')).valid).toBe(false);
    expect((await fake.checkVat('NL', '111')).valid).toBe(false);
  });
});

import { clients } from '@provisia/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

describe.skipIf(!TEST_URL)('clients routes', () => {
  let t: BillingTestApp;
  const base = '/api/v1/admin/clients';

  beforeAll(async () => {
    t = await setupBillingTestApp();
    await t.resetBilling();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a client with its login user and rejects duplicate emails', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: base,
      headers: t.adminHeaders,
      payload: {
        email: 'Acme@Example.com',
        firstName: 'Ann',
        lastName: 'Acme',
        companyName: 'Acme B.V.',
        country: 'NL',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body).toMatchObject({
      email: 'acme@example.com',
      firstName: 'Ann',
      companyName: 'Acme B.V.',
      creditBalance: 0,
      status: 'active',
    });
    expect(body.generatedPassword).toEqual(expect.any(String));
    // the generated password works
    const cookie = await t.login('acme@example.com', body.generatedPassword);
    expect(cookie).toMatch(/^pv_session=/);

    const dup = await t.app.inject({
      method: 'POST',
      url: base,
      headers: t.adminHeaders,
      payload: { email: 'acme@example.com', firstName: 'A', lastName: 'B' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('email_taken');
  });

  it('lists with search and filters', async () => {
    await t.createClient({
      email: 'zoe@search.example',
      firstName: 'Zoe',
      lastName: 'Zulu',
      companyName: 'Zulu Hosting',
      country: 'DE',
    });
    const bySearch = await t.app.inject({
      method: 'GET',
      url: `${base}?search=zulu`,
      headers: t.adminHeaders,
    });
    expect(bySearch.statusCode).toBe(200);
    expect(bySearch.json().data.map((c: { email: string }) => c.email)).toEqual([
      'zoe@search.example',
    ]);
    expect(bySearch.json().meta.total).toBe(1);
    const byCountry = await t.app.inject({
      method: 'GET',
      url: `${base}?country=DE`,
      headers: t.adminHeaders,
    });
    expect(byCountry.json().data.every((c: { country: string }) => c.country === 'DE')).toBe(true);
    const asClient = await t.app.inject({
      method: 'GET',
      url: base,
      headers: (await t.createClient()).headers,
    });
    expect(asClient.statusCode).toBe(403);
  });

  it('patch updates names, resets VAT validation on VAT/country change, and closes', async () => {
    const { client } = await t.createClient({
      vatNumber: 'NL123456789B01',
      vatValidated: true,
      vatValidatedAt: new Date(),
      vatCheckedAt: new Date(),
    });
    const rename = await t.app.inject({
      method: 'PATCH',
      url: `${base}/${client.id}`,
      headers: t.adminHeaders,
      payload: { firstName: 'Renamed', phone: '+31600000000' },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().data).toMatchObject({
      firstName: 'Renamed',
      phone: '+31600000000',
      vatValidated: true,
    });

    const vat = await t.app.inject({
      method: 'PATCH',
      url: `${base}/${client.id}`,
      headers: t.adminHeaders,
      payload: { vatNumber: 'NL999999999B01' },
    });
    expect(vat.json().data).toMatchObject({
      vatNumber: 'NL999999999B01',
      vatValidated: false,
      vatValidatedAt: null,
    });
    const [row] = await t.db.select().from(clients).where(eq(clients.id, client.id));
    expect(row?.vatCheckedAt).toBeNull();

    const closed = await t.app.inject({
      method: 'DELETE',
      url: `${base}/${client.id}`,
      headers: t.adminHeaders,
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.status).toBe('closed');
    const still = await t.app.inject({
      method: 'GET',
      url: `${base}/${client.id}`,
      headers: t.adminHeaders,
    });
    expect(still.statusCode).toBe(200);
  });

  it('manages contacts', async () => {
    const { client } = await t.createClient();
    const url = `${base}/${client.id}/contacts`;
    const created = await t.app.inject({
      method: 'POST',
      url,
      headers: t.adminHeaders,
      payload: {
        firstName: 'Bob',
        lastName: 'Billing',
        email: 'bob@example.com',
        permissions: { invoices: true },
        receivesInvoiceEmails: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const contact = created.json().data;
    expect(contact.permissions).toEqual({
      services: false,
      domains: false,
      invoices: true,
      tickets: true,
      profile: false,
    });

    const list = await t.app.inject({ method: 'GET', url, headers: t.adminHeaders });
    expect(list.json().data).toHaveLength(1);

    const patched = await t.app.inject({
      method: 'PATCH',
      url: `${url}/${contact.id}`,
      headers: t.adminHeaders,
      payload: { permissions: { tickets: false }, phone: '123' },
    });
    expect(patched.json().data.permissions).toEqual({
      services: false,
      domains: false,
      invoices: true,
      tickets: false,
      profile: false,
    });
    expect(patched.json().data.phone).toBe('123');

    const del = await t.app.inject({
      method: 'DELETE',
      url: `${url}/${contact.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(204);
    expect(
      (await t.app.inject({ method: 'GET', url, headers: t.adminHeaders })).json().data,
    ).toEqual([]);
    const missing = await t.app.inject({
      method: 'DELETE',
      url: `${url}/${contact.id}`,
      headers: t.adminHeaders,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('adjusts credit, lists transactions and refuses a negative balance', async () => {
    const { client, headers } = await t.createClient();
    const add = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/credit`,
      headers: t.adminHeaders,
      payload: { amount: 2500, description: 'Goodwill' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().data.creditBalance).toBe(2500);
    expect(add.json().data.transaction).toMatchObject({
      type: 'credit',
      amount: 2500,
      gateway: 'manual',
    });

    const deduct = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/credit`,
      headers: t.adminHeaders,
      payload: { amount: -500, description: 'Correction' },
    });
    expect(deduct.json().data.creditBalance).toBe(2000);

    const tooMuch = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/credit`,
      headers: t.adminHeaders,
      payload: { amount: -5000, description: 'Nope' },
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.code).toBe('insufficient_credit');

    const zero = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/credit`,
      headers: t.adminHeaders,
      payload: { amount: 0, description: 'x' },
    });
    expect(zero.statusCode).toBe(400);

    const txns = await t.app.inject({
      method: 'GET',
      url: `${base}/${client.id}/transactions`,
      headers: t.adminHeaders,
    });
    expect(txns.json().meta.total).toBe(2);
    const own = await t.app.inject({ method: 'GET', url: '/api/v1/portal/transactions', headers });
    expect(own.statusCode).toBe(200);
    expect(own.json().meta.total).toBe(2);
    const detail = await t.app.inject({
      method: 'GET',
      url: `${base}/${client.id}`,
      headers: t.adminHeaders,
    });
    expect(detail.json().data.creditBalance).toBe(2000);
  });

  it('validates VAT numbers through the (fake) VIES client and caches the result', async () => {
    const { client } = await t.createClient({ country: 'NL', vatNumber: 'nl 1234.56789.b01' });
    const first = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/vat/validate`,
      headers: t.adminHeaders,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      valid: true,
      cached: false,
      countryCode: 'NL',
      vatNumber: '123456789B01',
      unavailable: false,
    });
    const [row] = await t.db.select().from(clients).where(eq(clients.id, client.id));
    expect(row).toMatchObject({ vatValidated: true, vatNumber: 'NL123456789B01' });
    expect(row?.vatCheckedAt).toBeInstanceOf(Date);

    const second = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/vat/validate`,
      headers: t.adminHeaders,
      payload: {},
    });
    expect(second.json().data.cached).toBe(true);
    const forced = await t.app.inject({
      method: 'POST',
      url: `${base}/${client.id}/vat/validate`,
      headers: t.adminHeaders,
      payload: { force: true },
    });
    expect(forced.json().data.cached).toBe(false);

    const bad = await t.createClient({ country: 'NL', vatNumber: 'NL123456789B00' });
    const invalid = await t.app.inject({
      method: 'POST',
      url: `${base}/${bad.client.id}/vat/validate`,
      headers: t.adminHeaders,
    });
    expect(invalid.json().data.valid).toBe(false);
    const none = await t.createClient({ vatNumber: null });
    const noVat = await t.app.inject({
      method: 'POST',
      url: `${base}/${none.client.id}/vat/validate`,
      headers: t.adminHeaders,
    });
    expect(noVat.json().data).toMatchObject({ valid: false, reason: 'no_vat_number' });
  });

  it('serves and updates the portal profile; staff are forbidden', async () => {
    const { client, headers } = await t.createClient({
      vatNumber: 'NL123456789B01',
      vatValidated: true,
    });
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/portal/profile', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.id).toBe(client.id);
    expect(me.json().data.email).toEqual(expect.any(String));

    const upd = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/portal/profile',
      headers,
      payload: { city: 'Rotterdam', country: 'BE' },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data).toMatchObject({
      city: 'Rotterdam',
      country: 'BE',
      vatValidated: false,
    });

    const notAllowed = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/portal/profile',
      headers,
      payload: { status: 'closed', creditBalance: 999 },
    });
    expect(notAllowed.statusCode).toBe(200);
    expect(notAllowed.json().data).toMatchObject({ status: 'active', creditBalance: 0 });

    const staff = await t.app.inject({
      method: 'GET',
      url: '/api/v1/portal/profile',
      headers: t.adminHeaders,
    });
    expect(staff.statusCode).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/portal/profile' });
    expect(anon.statusCode).toBe(401);
  });
});

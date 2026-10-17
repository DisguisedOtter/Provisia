import { addDays, domainPeriodStartingAt, periodStartingAt, toIsoDate } from '@provisia/core';
import { domains, invoices, orders, products, services, tldPrices, tlds } from '@provisia/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

const TODAY = toIsoDate(new Date());

describe.skipIf(!TEST_URL)('orders routes', () => {
  let t: BillingTestApp;
  let productId: string;

  beforeAll(async () => {
    t = await setupBillingTestApp();
    const [p] = await t.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, 'starter-hosting'));
    if (!p) throw new Error('seed product missing');
    productId = p.id;
    const [tld] = await t.db
      .insert(tlds)
      .values({ tld: 'nl', registrarModule: 'skrime' })
      .onConflictDoUpdate({ target: tlds.tld, set: { enabled: true } })
      .returning({ id: tlds.id });
    if (!tld) throw new Error('tld');
    await t.db
      .insert(tldPrices)
      .values({
        tldId: tld.id,
        years: 1,
        currency: 'EUR',
        register: 999,
        renew: 1099,
        transfer: 899,
      })
      .onConflictDoUpdate({
        target: [tldPrices.tldId, tldPrices.years, tldPrices.currency],
        set: { register: 999, renew: 1099, transfer: 899 },
      });
  });
  afterAll(async () => t?.close());
  beforeEach(async () => t.resetBilling());

  const cart = (domain = 'example.nl') => ({
    items: [
      {
        type: 'product',
        productId,
        domainName: domain,
        billingCycle: 'monthly',
        quantity: 1,
        config: { php: '8.3' },
      },
      { type: 'domain_register', domainName: domain, billingCycle: 'annually', quantity: 1 },
    ],
  });

  it('quotes a guest cart from the country: NL gets VAT, non-EU is tax free', async () => {
    const nl = await t.app.inject({
      method: 'POST',
      url: '/api/v1/public/orders/quote',
      payload: { ...cart(), country: 'NL', promoCode: 'WELCOME' },
    });
    expect(nl.statusCode).toBe(200);
    expect(nl.json().data).toMatchObject({
      currency: 'EUR',
      subtotal: 1498,
      taxTotal: 315,
      total: 1813,
      reverseCharge: false,
      promoValid: false,
    });
    const us = await t.app.inject({
      method: 'POST',
      url: '/api/v1/public/orders/quote',
      payload: { ...cart(), country: 'US' },
    });
    expect(us.statusCode).toBe(200);
    expect(us.json().data).toMatchObject({ taxTotal: 0, total: 1498, promoValid: null });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/public/orders/quote',
      payload: { items: [], country: 'NL' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('quotes a cart with 21% NL VAT and rejects missing prices', async () => {
    const c = await t.createClient();
    const q = await t.app.inject({
      method: 'POST',
      url: '/api/v1/portal/orders/quote',
      headers: c.headers,
      payload: cart(),
    });
    expect(q.statusCode).toBe(200);
    expect(q.json().data).toMatchObject({
      currency: 'EUR',
      subtotal: 1498,
      taxTotal: 315,
      total: 1813,
      reverseCharge: false,
    });
    expect(q.json().data.lines[0]).toMatchObject({
      description: 'Starter Hosting - example.nl',
      amount: 499,
      taxRate: '21.00',
    });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/portal/orders/quote',
      headers: c.headers,
      payload: {
        items: [
          {
            type: 'product',
            productId,
            domainName: 'x.nl',
            billingCycle: 'quarterly',
            quantity: 1,
          },
        ],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('price_not_available');
    const noTld = await t.app.inject({
      method: 'POST',
      url: '/api/v1/portal/orders/quote',
      headers: c.headers,
      payload: {
        items: [
          { type: 'domain_register', domainName: 'x.xyz', billingCycle: 'annually', quantity: 1 },
        ],
      },
    });
    expect(noTld.json().error.code).toBe('tld_not_offered');
  });

  it('creates, accepts (services + domain + invoice), refuses a second accept, portal isolation', async () => {
    const c = await t.createClient();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      headers: t.adminHeaders,
      payload: { clientId: c.client.id, ...cart() },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order).toMatchObject({
      status: 'pending',
      total: 1813,
      number: expect.stringMatching(/^ORD-\d{4}-000001$/),
    });
    expect(order.items).toHaveLength(2);
    expect(order.items[0].config).toEqual({ php: '8.3' });

    const accepted = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${order.id}/accept`,
      headers: t.adminHeaders,
    });
    expect(accepted.statusCode).toBe(200);
    const a = accepted.json().data;
    expect(a.status).toBe('active');
    expect(a.invoice).toMatchObject({
      status: 'unpaid',
      total: 1813,
      number: expect.stringMatching(/-000001$/),
    });
    const svcItem = a.items.find((i: { type: string }) => i.type === 'product');
    const domItem = a.items.find((i: { type: string }) => i.type === 'domain_register');
    const [svc] = await t.db.select().from(services).where(eq(services.id, svcItem.serviceId));
    expect(svc).toMatchObject({
      status: 'pending',
      billingCycle: 'monthly',
      recurringAmount: 499,
      nextDueDate: TODAY,
      registrationDate: TODAY,
      domain: 'example.nl',
      moduleData: { config: { php: '8.3' } },
    });
    const [dom] = await t.db.select().from(domains).where(eq(domains.id, domItem.domainId));
    expect(dom).toMatchObject({
      status: 'pending',
      name: 'example.nl',
      tld: 'nl',
      registrationPeriod: 1,
      recurringAmount: 1099,
      registrarModule: 'skrime',
    });
    const inv = await t.db.query.invoices.findFirst({
      where: eq(invoices.id, a.invoice.id),
      with: { items: true },
    });
    expect(inv?.items.find((i) => i.serviceId === svc?.id)).toMatchObject({
      periodStart: TODAY,
      periodEnd: periodStartingAt(TODAY, 'monthly').end,
      unitAmount: 499,
    });
    expect(inv?.items.find((i) => i.domainId === dom?.id)).toMatchObject({
      periodStart: TODAY,
      periodEnd: domainPeriodStartingAt(TODAY, 1).end,
      unitAmount: 999,
    });
    const [o] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect(o?.invoiceId).toBe(a.invoice.id);

    const again = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${order.id}/accept`,
      headers: t.adminHeaders,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('order_not_pending');

    const other = await t.createClient();
    const forbidden = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/orders/${order.id}`,
      headers: other.headers,
    });
    expect(forbidden.statusCode).toBe(404);
    const mine = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/orders/${order.id}`,
      headers: c.headers,
    });
    expect(mine.statusCode).toBe(200);
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/v1/portal/orders',
      headers: other.headers,
    });
    expect(list.json().meta.total).toBe(0);
    expect(addDays(TODAY, 0)).toBe(TODAY);
  });

  it('portal order + cancel; admin cancel of an accepted-pending order cancels its invoice', async () => {
    const c = await t.createClient();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/portal/orders',
      headers: c.headers,
      payload: {
        items: [
          { type: 'product', productId, domainName: 'p.nl', billingCycle: 'annually', quantity: 1 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.total).toBe(6038);
    const cancelled = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/orders/${created.json().data.id}/cancel`,
      headers: c.headers,
      payload: { reason: 'changed my mind' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.status).toBe('cancelled');
    const twice = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/orders/${created.json().data.id}/cancel`,
      headers: c.headers,
      payload: {},
    });
    expect(twice.statusCode, twice.body).toBe(409);

    // Pending order that already has an unpaid invoice (simulate by linking one): cancel voids it.
    const o2 = await t.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      headers: t.adminHeaders,
      payload: {
        clientId: c.client.id,
        items: [
          { type: 'product', productId, domainName: 'q.nl', billingCycle: 'monthly', quantity: 1 },
        ],
      },
    });
    const acc = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${o2.json().data.id}/accept`,
      headers: t.adminHeaders,
    });
    const invId = acc.json().data.invoice.id;
    await t.db.update(orders).set({ status: 'pending' }).where(eq(orders.id, o2.json().data.id));
    const fraud = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${o2.json().data.id}/fraud`,
      headers: t.adminHeaders,
    });
    expect(fraud.statusCode, fraud.body).toBe(200);
    expect(fraud.json().data.status).toBe('fraud');
    const [inv] = await t.db
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invId));
    expect(inv?.status).toBe('cancelled');
  });

  it('requires permissions', async () => {
    const c = await t.createClient();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders',
      headers: c.headers,
    });
    expect(res.statusCode).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/portal/orders' });
    expect(anon.statusCode).toBe(401);
  });
});

import { addDays, convertCycleAmount, prorate, toIsoDate } from '@provisia/core';
import { clients, invoices, productGroups, productPrices, products, services } from '@provisia/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

const TODAY = toIsoDate(new Date());

describe.skipIf(!TEST_URL)('services routes', () => {
  let t: BillingTestApp;
  let starterId: string;
  let proId: string;

  beforeAll(async () => {
    t = await setupBillingTestApp();
    const [p] = await t.db
      .select({ id: products.id, groupId: products.groupId })
      .from(products)
      .where(eq(products.slug, 'starter-hosting'));
    if (!p) throw new Error('seed product missing');
    starterId = p.id;
    const [pro] = await t.db
      .insert(products)
      .values({
        groupId: p.groupId,
        name: 'Pro Hosting',
        slug: 'pro-hosting-test',
        type: 'hosting',
      })
      .onConflictDoUpdate({ target: products.slug, set: { groupId: p.groupId } })
      .returning({ id: products.id });
    if (!pro) throw new Error('pro');
    proId = pro.id;
    await t.db
      .insert(productPrices)
      .values([
        {
          productId: proId,
          billingCycle: 'monthly',
          currency: 'EUR',
          recurring: 1499,
          setupFee: 0,
        },
        {
          productId: proId,
          billingCycle: 'annually',
          currency: 'EUR',
          recurring: 14990,
          setupFee: 0,
        },
      ])
      .onConflictDoNothing();
    expect(productGroups).toBeDefined();
  });
  afterAll(async () => t?.close());
  beforeEach(async () => t.resetBilling());

  async function createSvc(clientId: string, over: Record<string, unknown> = {}) {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/admin/services',
      headers: t.adminHeaders,
      payload: {
        clientId,
        productId: starterId,
        billingCycle: 'monthly',
        recurringAmount: 499,
        domain: 'svc.nl',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  it('creates, lists, gets and patches services; portal strips module data', async () => {
    const c = await t.createClient();
    const svc = await createSvc(c.client.id);
    expect(svc).toMatchObject({
      status: 'pending',
      nextDueDate: TODAY,
      registrationDate: TODAY,
      productName: 'Starter Hosting',
    });
    await t.db
      .update(services)
      .set({ moduleData: { accountId: 42 }, notes: 'staff only' })
      .where(eq(services.id, svc.id));

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/services?clientId=${c.client.id}`,
      headers: t.adminHeaders,
    });
    expect(list.json().meta.total).toBe(1);
    expect(list.json().data[0].moduleData).toEqual({ accountId: 42 });

    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/services/${svc.id}`,
      headers: t.adminHeaders,
      payload: { status: 'active', username: 'svcuser' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({ status: 'active', username: 'svcuser' });
    const susp = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/services/${svc.id}`,
      headers: t.adminHeaders,
      payload: { status: 'suspended' },
    });
    expect(susp.json().data.suspendedAt).not.toBeNull();

    const portal = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/services/${svc.id}`,
      headers: c.headers,
    });
    expect(portal.statusCode).toBe(200);
    expect(portal.json().data.moduleData).toEqual({});
    expect(portal.json().data.notes).toBeNull();
    const other = await t.createClient();
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/portal/services/${svc.id}`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/services/${svc.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(409);
  });

  it('upgrades with a prorated invoice (credit + charge lines)', async () => {
    const c = await t.createClient();
    const nextDue = addDays(TODAY, 10);
    const svc = await createSvc(c.client.id, {
      status: 'active',
      registrationDate: '2026-01-15',
      nextDueDate: nextDue,
    });
    await t.db.update(services).set({ status: 'active' }).where(eq(services.id, svc.id));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/services/${svc.id}/change-package`,
      headers: t.adminHeaders,
      payload: { productId: proId },
    });
    expect(res.statusCode).toBe(200);
    const { service, proration, invoiceId } = res.json().data;
    const expected = prorate({
      changeDate: TODAY,
      nextDueDate: nextDue,
      billingCycle: 'monthly',
      oldAmount: 499,
      newAmount: 1499,
      anchorDay: 15,
    });
    expect(proration).toMatchObject({
      credit: expected.credit,
      charge: expected.charge,
      net: expected.net,
      daysRemaining: 10,
    });
    expect(expected.net).toBeGreaterThan(0);
    expect(service).toMatchObject({
      productId: proId,
      recurringAmount: 1499,
      productName: 'Pro Hosting',
    });
    const inv = await t.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      with: { items: true },
    });
    expect(inv?.status).toBe('unpaid');
    expect(inv?.subtotal).toBe(expected.net);
    expect(inv?.items.map((i) => i.unitAmount).sort((a, b) => a - b)).toEqual([
      -expected.credit,
      expected.charge,
    ]);
    expect(inv?.items.find((i) => i.unitAmount > 0)).toMatchObject({
      serviceId: svc.id,
      periodStart: TODAY,
      periodEnd: expected.periodEnd,
    });
    expect(inv?.items.find((i) => i.unitAmount < 0)?.serviceId).toBeNull();
  });

  it('downgrades (also across cycles) by crediting the balance; guards', async () => {
    const c = await t.createClient();
    const nextDue = addDays(TODAY, 20);
    const svc = await createSvc(c.client.id, {
      productId: proId,
      recurringAmount: 1499,
      registrationDate: '2026-01-01',
      nextDueDate: nextDue,
    });
    await t.db.update(services).set({ status: 'active' }).where(eq(services.id, svc.id));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/services/${svc.id}/change-package`,
      headers: t.adminHeaders,
      payload: { productId: starterId, billingCycle: 'annually' },
    });
    expect(res.statusCode).toBe(200);
    const { proration, invoiceId, service } = res.json().data;
    const expected = prorate({
      changeDate: TODAY,
      nextDueDate: nextDue,
      billingCycle: 'monthly',
      oldAmount: 1499,
      newAmount: convertCycleAmount(4990, 'annually', 'monthly'),
      anchorDay: 1,
    });
    expect(proration.net).toBe(expected.net);
    expect(expected.net).toBeLessThan(0);
    expect(invoiceId).toBeNull();
    expect(service).toMatchObject({ billingCycle: 'annually', recurringAmount: 4990 });
    const [cl] = await t.db.select().from(clients).where(eq(clients.id, c.client.id));
    expect(cl?.creditBalance).toBe(-expected.net);

    const onetime = await createSvc(c.client.id, {
      billingCycle: 'onetime',
      recurringAmount: 0,
      nextDueDate: null,
    });
    await t.db.update(services).set({ status: 'active' }).where(eq(services.id, onetime.id));
    const bad = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/services/${onetime.id}/change-package`,
      headers: t.adminHeaders,
      payload: { productId: proId },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('onetime_not_prorated');
    const pending = await createSvc(c.client.id);
    const notActive = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/services/${pending.id}/change-package`,
      headers: t.adminHeaders,
      payload: { productId: proId },
    });
    expect(notActive.statusCode).toBe(409);
  });

  it('cancels end-of-term from the portal and immediately from admin', async () => {
    const c = await t.createClient();
    const svc = await createSvc(c.client.id);
    const eot = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/services/${svc.id}/cancel`,
      headers: c.headers,
      payload: { reason: 'moving' },
    });
    expect(eot.statusCode).toBe(200);
    expect(eot.json().data.cancellationRequestedAt).not.toBeNull();
    expect(eot.json().data.status).toBe('pending');
    const now = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/services/${svc.id}/cancel`,
      headers: t.adminHeaders,
      payload: { immediate: true },
    });
    expect(now.json().data).toMatchObject({ status: 'cancelled' });
    expect(now.json().data.terminatedAt).not.toBeNull();
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/services/${svc.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(204);
  });
});

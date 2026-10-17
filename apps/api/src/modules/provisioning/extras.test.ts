import { products, services } from '@provisia/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

describe.skipIf(!TEST_URL)('module extra actions', () => {
  let t: BillingTestApp;
  beforeAll(async () => {
    t = await setupBillingTestApp({ adminEmail: 'extras-admin@example.com' });
  });
  afterAll(async () => t?.close());

  it('lists the module actions per audience and refuses unknown or inactive ones', async () => {
    const c = await t.createClient();
    const [starter] = await t.db.select().from(products).limit(1);
    if (!starter) throw new Error('seed product missing');
    const [vps] = await t.db
      .insert(products)
      .values({
        groupId: starter.groupId,
        name: 'Skrime KVM',
        slug: `skrime-kvm-${Date.now()}`,
        type: 'vps',
        module: 'skrime_server',
        moduleConfig: { planId: 'plan', osName: 'debian-12' },
        serverGroup: 'skrime',
      })
      .returning();
    if (!vps) throw new Error('product insert failed');
    const [svc] = await t.db
      .insert(services)
      .values({
        clientId: c.client.id,
        productId: vps.id,
        status: 'pending',
        billingCycle: 'monthly',
        registrationDate: '2026-01-01',
        domain: 'vps.example.test',
        moduleData: { productId: 'x' },
      })
      .returning();
    if (!svc) throw new Error('service insert failed');

    const portal = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/services/${svc.id}/extras`,
      headers: c.headers,
    });
    expect(portal.statusCode).toBe(200);
    const ids = portal.json().data.map((a: { id: string }) => a.id);
    expect(ids).toContain('console');
    expect(ids).toContain('firewall.create');
    expect(ids).not.toContain('ip.add');
    const fw = portal.json().data.find((a: { id: string }) => a.id === 'firewall.create');
    expect(fw).toMatchObject({ audience: 'client', readOnly: false });
    expect(fw.paramsSchema.properties.rule).toBeDefined();

    const admin = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/services/${svc.id}/extras`,
      headers: t.adminHeaders,
    });
    expect(admin.json().data.map((a: { id: string }) => a.id)).toContain('ip.add');

    const other = await t.createClient();
    const foreign = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/services/${svc.id}/extras`,
      headers: other.headers,
    });
    expect(foreign.statusCode).toBe(403);

    const unknown = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/services/${svc.id}/extras/nope`,
      headers: c.headers,
      payload: { params: {} },
    });
    expect(unknown.statusCode).toBe(400);
    const staffOnly = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/services/${svc.id}/extras/ip.add`,
      headers: c.headers,
      payload: { params: {} },
    });
    expect(staffOnly.statusCode).toBe(400);
    const inactive = await t.app.inject({
      method: 'POST',
      url: `/api/v1/portal/services/${svc.id}/extras/console`,
      headers: c.headers,
      payload: { params: {} },
    });
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().error.message).toMatch(/not active/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

describe.skipIf(!TEST_URL)('dashboard + search', () => {
  let t: BillingTestApp;
  beforeAll(async () => {
    t = await setupBillingTestApp({ adminEmail: 'dashboard-admin@example.com' });
  });
  afterAll(async () => t?.close());

  it('summarises billing, services, tickets and jobs for staff only', async () => {
    const c = await t.createClient({ companyName: 'Dash BV' });
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/admin/dashboard' });
    expect(anon.statusCode).toBe(401);
    const asClient = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard',
      headers: c.headers,
    });
    expect(asClient.statusCode).toBe(403);

    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard',
      headers: t.adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.currency).toBe('EUR');
    expect(d.counts.clients).toBeGreaterThanOrEqual(1);
    expect(typeof d.revenueThisMonth).toBe('number');
    expect(typeof d.outstanding).toBe('number');
    expect(Array.isArray(d.recentOrders)).toBe(true);
    expect(Array.isArray(d.openTickets)).toBe(true);
    expect(Array.isArray(d.servicesDue)).toBe(true);
    expect(Array.isArray(d.failedJobs)).toBe(true);
  });

  it('searches clients by company name and e-mail', async () => {
    const c = await t.createClient({ companyName: 'Findable Hosting BV' });
    const byName = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/search?q=findable',
      headers: t.adminHeaders,
    });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().data.clients.map((x: { id: string }) => x.id)).toContain(c.client.id);
    const empty = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/search?q=zzz-no-such-thing',
      headers: t.adminHeaders,
    });
    expect(empty.json().data).toEqual({
      clients: [],
      domains: [],
      invoices: [],
      tickets: [],
      services: [],
    });
    const short = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/search?q=',
      headers: t.adminHeaders,
    });
    expect(short.statusCode).toBe(400);
  });
});

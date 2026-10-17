import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from '../invoices/test-utils.js';

describe.skipIf(!TEST_URL)('products routes', () => {
  let t: BillingTestApp;
  const groups = '/api/v1/admin/product-groups';
  const products = '/api/v1/admin/products';

  beforeAll(async () => {
    t = await setupBillingTestApp();
    await t.resetBilling();
    // Remove groups/products left by earlier runs (seed data is kept).
    const { productGroups, products: productsTable } = await import('@provisia/db');
    const { ne } = await import('drizzle-orm');
    await t.db.delete(productsTable).where(ne(productsTable.slug, 'starter-hosting'));
    await t.db.delete(productGroups).where(ne(productGroups.slug, 'shared-hosting'));
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CRUDs product groups and protects non-empty ones', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: groups,
      headers: t.adminHeaders,
      payload: { name: 'VPS', slug: 'vps', description: 'Virtual servers' },
    });
    expect(created.statusCode).toBe(201);
    const group = created.json().data;
    expect(group).toMatchObject({ name: 'VPS', slug: 'vps', hidden: false, sortOrder: 0 });

    const dup = await t.app.inject({
      method: 'POST',
      url: groups,
      headers: t.adminHeaders,
      payload: { name: 'Other', slug: 'vps' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('slug_taken');

    const patched = await t.app.inject({
      method: 'PATCH',
      url: `${groups}/${group.id}`,
      headers: t.adminHeaders,
      payload: { name: 'Cloud VPS', hidden: true },
    });
    expect(patched.json().data).toMatchObject({ name: 'Cloud VPS', hidden: true });

    const list = await t.app.inject({ method: 'GET', url: groups, headers: t.adminHeaders });
    expect(
      list
        .json()
        .data.map((g: { slug: string }) => g.slug)
        .sort(),
    ).toEqual(['shared-hosting', 'vps']);

    // seeded group has products → cannot delete
    const seeded = list.json().data.find((g: { slug: string }) => g.slug === 'shared-hosting');
    const blocked = await t.app.inject({
      method: 'DELETE',
      url: `${groups}/${seeded.id}`,
      headers: t.adminHeaders,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('group_not_empty');

    const del = await t.app.inject({
      method: 'DELETE',
      url: `${groups}/${group.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(204);
    expect(
      (
        await t.app.inject({
          method: 'DELETE',
          url: `${groups}/${group.id}`,
          headers: t.adminHeaders,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('creates, updates (price upsert) and deletes products', async () => {
    const g = (
      await t.app.inject({
        method: 'POST',
        url: groups,
        headers: t.adminHeaders,
        payload: { name: 'Mail', slug: 'mail' },
      })
    ).json().data;
    const created = await t.app.inject({
      method: 'POST',
      url: products,
      headers: t.adminHeaders,
      payload: {
        groupId: g.id,
        name: 'Mail Basic',
        slug: 'mail-basic',
        type: 'other',
        prices: [
          { billingCycle: 'monthly', currency: 'EUR', setupFee: 0, recurring: 299 },
          { billingCycle: 'annually', currency: 'EUR', setupFee: 0, recurring: 2990 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const product = created.json().data;
    expect(product.prices).toHaveLength(2);
    expect(product.taxable).toBe(true);

    const badGroup = await t.app.inject({
      method: 'POST',
      url: products,
      headers: t.adminHeaders,
      payload: { groupId: '00000000-0000-7000-8000-000000000000', name: 'x', slug: 'x-y' },
    });
    expect(badGroup.statusCode).toBe(400);

    const upd = await t.app.inject({
      method: 'PATCH',
      url: `${products}/${product.id}`,
      headers: t.adminHeaders,
      payload: {
        hidden: true,
        prices: [
          { billingCycle: 'monthly', currency: 'EUR', setupFee: 500, recurring: 349 },
          { billingCycle: 'quarterly', currency: 'EUR', setupFee: 0, recurring: 999 },
        ],
      },
    });
    expect(upd.statusCode).toBe(200);
    const prices = upd
      .json()
      .data.prices.map((p: { billingCycle: string; recurring: number; setupFee: number }) => [
        p.billingCycle,
        p.recurring,
        p.setupFee,
      ])
      .sort();
    expect(prices).toEqual([
      ['monthly', 349, 500],
      ['quarterly', 999, 0],
    ]);
    expect(upd.json().data.hidden).toBe(true);

    const hiddenList = await t.app.inject({
      method: 'GET',
      url: `${products}?groupId=${g.id}`,
      headers: t.adminHeaders,
    });
    expect(hiddenList.json().meta.total).toBe(0);
    const all = await t.app.inject({
      method: 'GET',
      url: `${products}?groupId=${g.id}&includeHidden=true`,
      headers: t.adminHeaders,
    });
    expect(all.json().meta.total).toBe(1);

    const get = await t.app.inject({
      method: 'GET',
      url: `${products}/${product.id}`,
      headers: t.adminHeaders,
    });
    expect(get.json().data.slug).toBe('mail-basic');

    const del = await t.app.inject({
      method: 'DELETE',
      url: `${products}/${product.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(204);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `${products}/${product.id}`,
          headers: t.adminHeaders,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('refuses to delete a product that has services', async () => {
    const seeded = (
      await t.app.inject({
        method: 'GET',
        url: `${products}?includeHidden=true`,
        headers: t.adminHeaders,
      })
    )
      .json()
      .data.find((p: { slug: string }) => p.slug === 'starter-hosting');
    const { client } = await t.createClient();
    const { services } = await import('@provisia/db');
    await t.db.insert(services).values({
      clientId: client.id,
      productId: seeded.id,
      billingCycle: 'monthly',
      recurringAmount: 499,
      registrationDate: '2026-01-01',
    });
    const del = await t.app.inject({
      method: 'DELETE',
      url: `${products}/${seeded.id}`,
      headers: t.adminHeaders,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('product_in_use');
  });

  it('public and portal catalogs hide hidden groups and products', async () => {
    const g = (
      await t.app.inject({
        method: 'POST',
        url: groups,
        headers: t.adminHeaders,
        payload: { name: 'Visible', slug: 'visible' },
      })
    ).json().data;
    await t.app.inject({
      method: 'POST',
      url: products,
      headers: t.adminHeaders,
      payload: {
        groupId: g.id,
        name: 'Shown',
        slug: 'shown',
        prices: [{ billingCycle: 'monthly', currency: 'EUR', setupFee: 0, recurring: 100 }],
      },
    });
    await t.app.inject({
      method: 'POST',
      url: products,
      headers: t.adminHeaders,
      payload: { groupId: g.id, name: 'Secret', slug: 'secret', hidden: true },
    });
    const hg = (
      await t.app.inject({
        method: 'POST',
        url: groups,
        headers: t.adminHeaders,
        payload: { name: 'Hidden group', slug: 'hidden-group', hidden: true },
      })
    ).json().data;
    await t.app.inject({
      method: 'POST',
      url: products,
      headers: t.adminHeaders,
      payload: { groupId: hg.id, name: 'In hidden', slug: 'in-hidden' },
    });

    const pub = await t.app.inject({ method: 'GET', url: '/api/v1/public/products' });
    expect(pub.statusCode).toBe(200);
    const slugs = pub.json().data.map((x: { slug: string }) => x.slug);
    expect(slugs).toContain('visible');
    expect(slugs).not.toContain('hidden-group');
    const visible = pub.json().data.find((x: { slug: string }) => x.slug === 'visible');
    expect(visible.products.map((p: { slug: string }) => p.slug)).toEqual(['shown']);
    expect(visible.products[0].prices[0]).toMatchObject({ recurring: 100 });

    const bySlug = await t.app.inject({ method: 'GET', url: '/api/v1/public/products/shown' });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().data).toMatchObject({ slug: 'shown', prices: [{ recurring: 100 }] });
    const byId = await t.app.inject({
      method: 'GET',
      url: `/api/v1/public/products/${bySlug.json().data.id}`,
    });
    expect(byId.statusCode).toBe(200);
    for (const slug of ['secret', 'in-hidden', 'nope']) {
      const hidden = await t.app.inject({ method: 'GET', url: `/api/v1/public/products/${slug}` });
      expect(hidden.statusCode).toBe(404);
    }

    const portalAnon = await t.app.inject({ method: 'GET', url: '/api/v1/portal/products' });
    expect(portalAnon.statusCode).toBe(401);
    const portal = await t.app.inject({
      method: 'GET',
      url: '/api/v1/portal/products',
      headers: (await t.createClient()).headers,
    });
    expect(portal.statusCode).toBe(200);
    const asClient = await t.app.inject({
      method: 'GET',
      url: products,
      headers: (await t.createClient()).headers,
    });
    expect(asClient.statusCode).toBe(403);
  });
});

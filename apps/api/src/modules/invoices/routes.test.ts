import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BillingTestApp, setupBillingTestApp, TEST_URL } from './test-utils.js';

const YEAR = new Date().toISOString().slice(0, 4);

describe.skipIf(!TEST_URL)('invoices routes', () => {
  let t: BillingTestApp;
  let client: Awaited<ReturnType<BillingTestApp['createClient']>>;
  let other: Awaited<ReturnType<BillingTestApp['createClient']>>;

  beforeAll(async () => {
    t = await setupBillingTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await t.resetBilling();
    client = await t.createClient({ language: 'nl' });
    other = await t.createClient({
      country: 'DE',
      vatNumber: 'DE123456789',
      vatValidated: true,
      companyName: 'Muster GmbH',
    });
  });

  const createDraft = async (
    clientId: string,
    items = [{ description: 'Hosting', unitAmount: 499, quantity: 2 }],
  ) => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/admin/invoices',
      headers: t.adminHeaders,
      payload: { clientId, items },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as {
      id: string;
      total: number;
      status: string;
      items: Array<{ id: string }>;
    };
  };

  it('requires staff for admin routes and a client for portal routes', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/admin/invoices' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/v1/admin/invoices',
          headers: client.headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/v1/portal/invoices',
          headers: t.adminHeaders,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('creates a draft, edits lines, issues with the first number of the year and locks it', async () => {
    const draft = await createDraft(client.client.id);
    expect(draft.status).toBe('draft');
    expect(draft.total).toBe(1208); // 998 + 21%

    const add = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/items`,
      headers: t.adminHeaders,
      payload: { description: 'Domain', unitAmount: 1000, taxRate: '0.00' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().data.total).toBe(2208);
    const itemId = add
      .json()
      .data.items.find((i: { description: string }) => i.description === 'Domain').id;
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/invoices/${draft.id}/items/${itemId}`,
      headers: t.adminHeaders,
      payload: { quantity: 2 },
    });
    expect(edit.json().data.total).toBe(3208);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/invoices/${draft.id}/items/${itemId}`,
      headers: t.adminHeaders,
    });
    expect(del.json().data.total).toBe(1208);

    const issue = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/issue`,
      headers: t.adminHeaders,
    });
    expect(issue.statusCode).toBe(200);
    expect(issue.json().data).toMatchObject({
      number: `${YEAR}-000001`,
      status: 'unpaid',
      creditApplied: 0,
      settled: false,
      taxRate: '21.00',
    });

    const again = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/issue`,
      headers: t.adminHeaders,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invoice_locked');
    const editLocked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/items`,
      headers: t.adminHeaders,
      payload: { description: 'x', unitAmount: 1 },
    });
    expect(editLocked.statusCode).toBe(409);

    const detail = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${draft.id}`,
      headers: t.adminHeaders,
    });
    expect(detail.json().data).toMatchObject({ balance: 1208, transactions: [] });
  });

  it('assigns gap-free numbers when issued concurrently through the API', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 8 }, () => createDraft(client.client.id)),
    );
    const results = await Promise.all(
      drafts.map((d) =>
        t.app.inject({
          method: 'POST',
          url: `/api/v1/admin/invoices/${d.id}/issue`,
          headers: t.adminHeaders,
        }),
      ),
    );
    const numbers = results.map((r) => r.json().data.number as string).sort();
    expect(numbers).toEqual(
      Array.from({ length: 8 }, (_, i) => `${YEAR}-${String(i + 1).padStart(6, '0')}`),
    );
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices?status=unpaid&perPage=5`,
      headers: t.adminHeaders,
    });
    expect(list.json().meta).toEqual({ page: 1, perPage: 5, total: 8 });
    expect(list.json().data).toHaveLength(5);
  });

  it('reverse-charges a validated EU business and records the note in the snapshot', async () => {
    const draft = await createDraft(other.client.id);
    expect(draft.total).toBe(998);
    const issue = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/issue`,
      headers: t.adminHeaders,
    });
    expect(issue.json().data.reverseCharge).toBe(true);
    const pdf = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${draft.id}/pdf`,
      headers: t.adminHeaders,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('marks paid (overpayment to credit), refuses cancel afterwards, issues a credit note', async () => {
    const draft = await createDraft(client.client.id);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/issue`,
      headers: t.adminHeaders,
    });
    const pay = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/pay`,
      headers: t.adminHeaders,
      payload: { amount: 1300, gateway: 'manual', description: 'Bank transfer' },
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().data).toMatchObject({
      status: 'paid',
      settled: true,
      overpayment: 92,
      transaction: { type: 'payment', amount: 1300 },
    });

    const cancel = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/cancel`,
      headers: t.adminHeaders,
      payload: { reason: 'oops' },
    });
    expect(cancel.statusCode).toBe(409);

    const cn = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${draft.id}/credit-note`,
      headers: t.adminHeaders,
      payload: { reason: 'Downtime' },
    });
    expect(cn.statusCode).toBe(201);
    expect(cn.json().data).toMatchObject({ number: `CN-${YEAR}-000001`, total: 1208 });
    expect(cn.json().data.items).toHaveLength(1);
    const cnPdf = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/credit-notes/${cn.json().data.id}/pdf`,
      headers: t.adminHeaders,
    });
    expect(cnPdf.statusCode).toBe(200);

    const txns = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/transactions?clientId=${client.client.id}`,
      headers: t.adminHeaders,
    });
    expect(
      txns
        .json()
        .data.map((x: { type: string }) => x.type)
        .sort(),
    ).toEqual(['payment', 'refund']);
    const after = await t.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${draft.id}`,
      headers: t.adminHeaders,
    });
    expect(after.json().data.status).toBe('refunded');
  });

  it('cancels unpaid invoices and keeps the number unused', async () => {
    const d1 = await createDraft(client.client.id);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${d1.id}/issue`,
      headers: t.adminHeaders,
    });
    const cancel = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${d1.id}/cancel`,
      headers: t.adminHeaders,
      payload: { reason: 'duplicate' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe('cancelled');
    const d2 = await createDraft(client.client.id);
    const issued = await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${d2.id}/issue`,
      headers: t.adminHeaders,
    });
    expect(issued.json().data.number).toBe(`${YEAR}-000002`);
  });

  it('portal: clients only see their own issued invoices', async () => {
    const mine = await createDraft(client.client.id);
    const draftOnly = await createDraft(client.client.id);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${mine.id}/issue`,
      headers: t.adminHeaders,
    });
    const theirs = await createDraft(other.client.id);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${theirs.id}/issue`,
      headers: t.adminHeaders,
    });

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/v1/portal/invoices',
      headers: client.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((i: { id: string }) => i.id)).toEqual([mine.id]);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/portal/invoices/${mine.id}`,
          headers: client.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/portal/invoices/${draftOnly.id}`,
          headers: client.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/portal/invoices/${theirs.id}`,
          headers: client.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/portal/invoices/${theirs.id}/pdf`,
          headers: client.headers,
        })
      ).statusCode,
    ).toBe(404);
    const pdf = await t.app.inject({
      method: 'GET',
      url: `/api/v1/portal/invoices/${mine.id}/pdf`,
      headers: client.headers,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('validates input and returns the error envelope', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/admin/invoices',
      headers: t.adminHeaders,
      payload: { clientId: client.client.id, items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices/00000000-0000-7000-8000-000000000000',
      headers: t.adminHeaders,
    });
    expect(missing.statusCode).toBe(404);
  });
});

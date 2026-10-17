import { createModuleContext, type InvoiceDTO, type RawRequest } from '@provisia/module-sdk';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mollie, { type MollieConfig, mollieConfigSchema } from './index.js';

const API = 'https://mollie.test';
const config: MollieConfig = mollieConfigSchema.parse({ apiKey: 'test_abc', apiBaseUrl: API });
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = (overrides: Partial<MollieConfig> = {}) =>
  createModuleContext<MollieConfig>({
    config: { ...config, ...overrides },
    logger: silent,
    appUrl: 'http://api.test',
    webUrl: 'http://web.test',
  });

const invoice: InvoiceDTO = {
  id: '0192f1a0-0000-7000-8000-000000000001',
  clientId: '0192f1a0-0000-7000-8000-0000000000c1',
  number: '2026-000042',
  status: 'unpaid',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'EUR',
  subtotal: 1000,
  taxTotal: 210,
  creditApplied: 0,
  total: 1210,
  taxRate: '21.00',
  reverseCharge: false,
  paidAt: null,
  pdfPath: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  client: {
    id: '0192f1a0-0000-7000-8000-0000000000c1',
    email: 'c@example.com',
    name: 'Jane',
    companyName: null,
    country: 'NL',
  },
};

function webhook(id: string): RawRequest {
  const rawBody = Buffer.from(`id=${id}`);
  return {
    method: 'POST',
    url: '/api/v1/public/webhooks/mollie',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    rawBody,
    body: undefined,
    query: {},
  };
}

const payments: Record<string, Record<string, unknown>> = {
  tr_paid: {
    id: 'tr_paid',
    status: 'paid',
    method: 'ideal',
    amount: { currency: 'EUR', value: '12.10' },
    settlementAmount: { currency: 'EUR', value: '11.81' },
    metadata: { invoiceId: invoice.id },
  },
  tr_open: {
    id: 'tr_open',
    status: 'open',
    amount: { currency: 'EUR', value: '12.10' },
    metadata: { invoiceId: invoice.id },
  },
  tr_failed: {
    id: 'tr_failed',
    status: 'failed',
    amount: { currency: 'EUR', value: '12.10' },
    metadata: { invoiceId: invoice.id },
    details: { failureReason: 'insufficient_funds' },
  },
  tr_first: {
    id: 'tr_first',
    status: 'paid',
    sequenceType: 'first',
    customerId: 'cst_1',
    mandateId: 'mdt_1',
    amount: { currency: 'EUR', value: '0.01' },
    metadata: { clientId: invoice.client.id, setup: true },
  },
};

const calls: Array<{ method: string; path: string; body: unknown; headers: Headers }> = [];
const server = setupServer(
  http.get(`${API}/v2/payments/:id`, ({ params }) => {
    const p = payments[String(params.id)];
    return p
      ? HttpResponse.json(p)
      : HttpResponse.json(
          {
            status: 404,
            title: 'Not Found',
            detail: `No payment exists with token ${String(params.id)}`,
          },
          { status: 404 },
        );
  }),
  http.post(`${API}/v2/payments`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    calls.push({ method: 'POST', path: '/v2/payments', body, headers: request.headers });
    if (body.sequenceType === 'recurring') {
      return HttpResponse.json({
        id: 'tr_rec',
        status: body.mandateId === 'mdt_bad' ? 'failed' : 'pending',
        details: { failureReason: 'invalid_mandate' },
      });
    }
    return HttpResponse.json({
      id: body.sequenceType === 'first' ? 'tr_first' : 'tr_new',
      status: 'open',
      _links: { checkout: { href: 'https://www.mollie.com/checkout/select-method/tr_new' } },
    });
  }),
  http.post(`${API}/v2/payments/:id/refunds`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    calls.push({
      method: 'POST',
      path: `/v2/payments/${params.id}/refunds`,
      body,
      headers: request.headers,
    });
    return HttpResponse.json({ id: 're_1', status: 'pending', amount: body.amount });
  }),
  http.post(`${API}/v2/customers`, () => HttpResponse.json({ id: 'cst_1' })),
  http.get(`${API}/v2/customers/:cid/mandates/:mid`, ({ params }) =>
    HttpResponse.json({
      id: params.mid,
      status: 'valid',
      method: 'directdebit',
      signatureDate: '2026-10-17',
      details: {
        consumerName: 'J. Client',
        consumerAccount: 'NL55INGB0000000000',
        consumerBic: 'INGBNL2A',
      },
    }),
  ),
  http.delete(
    `${API}/v2/customers/:cid/mandates/:mid`,
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get(`${API}/v2/methods`, ({ request }) =>
    request.headers.get('authorization') === 'Bearer test_abc'
      ? HttpResponse.json({ count: 4 })
      : HttpResponse.json(
          {
            status: 401,
            title: 'Unauthorized Request',
            detail: 'Missing authentication, or failed to authenticate',
          },
          { status: 401 },
        ),
  ),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
});
afterAll(() => server.close());

describe('mollie gateway', () => {
  it('creates a payment with checkout link, webhook url and invoice metadata', async () => {
    const res = await mollie.createPayment(ctx(), invoice);
    expect(res).toEqual({
      redirectUrl: 'https://www.mollie.com/checkout/select-method/tr_new',
      txnId: 'tr_new',
    });
    expect(calls[0]?.body).toMatchObject({
      amount: { currency: 'EUR', value: '12.10' },
      webhookUrl: 'http://api.test/api/v1/public/webhooks/mollie',
      redirectUrl: `http://web.test/portal/invoices/${invoice.id}?payment=return`,
      metadata: { invoiceId: invoice.id },
      method: ['ideal', 'banktransfer', 'creditcard', 'bancontact'],
    });
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test_abc');
  });

  it('resolves webhook ids by fetching the payment and maps statuses', async () => {
    const paid = await mollie.handleWebhook(ctx(), webhook('tr_paid'));
    expect(paid).toMatchObject({
      kind: 'payment',
      eventId: 'tr_paid:paid',
      txnId: 'tr_paid',
      invoiceId: invoice.id,
      amount: { amount: 1210, currency: 'EUR' },
      fee: { amount: 29 },
    });
    // Duplicate delivery: identical result, same event id -> ledger no-op.
    expect(await mollie.handleWebhook(ctx(), webhook('tr_paid'))).toEqual(paid);
    expect(await mollie.handleWebhook(ctx(), webhook('tr_open'))).toMatchObject({
      kind: 'ignored',
    });
    expect(await mollie.handleWebhook(ctx(), webhook('tr_failed'))).toMatchObject({
      kind: 'failed',
      reason: 'insufficient_funds',
    });
  });

  it('ignores the posted body content and rejects unknown ids (no spoofing without API state)', async () => {
    const spoofed: RawRequest = {
      ...webhook('tr_missing'),
      body: { id: 'tr_missing', status: 'paid' },
    };
    await expect(mollie.handleWebhook(ctx(), spoofed)).rejects.toThrow(/No payment exists/);
    await expect(
      mollie.handleWebhook(ctx(), { ...webhook(''), rawBody: Buffer.from('') }),
    ).rejects.toThrow(/without id/);
  });

  it('turns a paid first payment into a saved mandate', async () => {
    const res = await mollie.handleWebhook(ctx(), webhook('tr_first'));
    expect(res).toMatchObject({
      kind: 'setup_completed',
      setupId: 'tr_first',
      clientId: invoice.client.id,
      method: {
        type: 'directdebit',
        gatewayCustomerId: 'cst_1',
        gatewayMethodId: 'mdt_1',
        label: 'SEPA NL55 •••• 0000',
      },
    });
  });

  it('creates a first payment for setup and charges recurring payments', async () => {
    const setup = await mollie.createSetup?.(ctx(), {
      client: { id: invoice.client.id, email: 'c@example.com', name: 'Jane' },
      gatewayCustomerId: null,
      returnUrl: 'http://web.test/portal/billing/methods',
    });
    expect(setup).toMatchObject({ setupId: 'tr_first', gatewayCustomerId: 'cst_1' });
    expect(calls[0]?.body).toMatchObject({
      sequenceType: 'first',
      customerId: 'cst_1',
      amount: { value: '0.01' },
      metadata: { setup: true, clientId: invoice.client.id },
    });

    const method = {
      id: 'pm-1',
      clientId: invoice.clientId,
      gateway: 'mollie',
      type: 'directdebit',
      gatewayCustomerId: 'cst_1',
      gatewayMethodId: 'mdt_1',
      label: 'SEPA',
      expiresAt: null,
      isDefault: true,
      status: 'active' as const,
      details: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(await mollie.chargeSavedMethod?.(ctx(), invoice, method)).toEqual({
      txnId: 'tr_rec',
      status: 'pending',
    });
    expect(calls[1]?.body).toMatchObject({
      sequenceType: 'recurring',
      mandateId: 'mdt_1',
      metadata: { invoiceId: invoice.id },
    });
    expect(
      await mollie.chargeSavedMethod?.(ctx(), invoice, { ...method, gatewayMethodId: 'mdt_bad' }),
    ).toEqual({ txnId: 'tr_rec', status: 'failed', reason: 'invalid_mandate' });
    await expect(mollie.removeSavedMethod?.(ctx(), method)).resolves.toBeUndefined();
  });

  it('refunds and reports pending until Mollie confirms', async () => {
    const res = await mollie.refund?.(
      ctx(),
      {
        id: 'tx-1',
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        gateway: 'mollie',
        gatewayTxnId: 'tr_paid',
        type: 'payment',
        amount: 1210,
        fee: 29,
        currency: 'EUR',
        description: null,
        createdAt: new Date(),
      },
      { amount: 1000, currency: 'EUR' },
    );
    expect(res).toEqual({
      refundTxnId: 're_1',
      amount: { amount: 1000, currency: 'EUR' },
      status: 'pending',
    });
    expect(calls[0]).toMatchObject({
      path: '/v2/payments/tr_paid/refunds',
      body: { amount: { currency: 'EUR', value: '10.00' } },
    });
  });

  it('tests credentials and polls status', async () => {
    expect(await mollie.testCredentials?.(ctx())).toMatchObject({ ok: true });
    expect(await mollie.testCredentials?.(ctx({ apiKey: 'test_wrong' }))).toMatchObject({
      ok: false,
    });
    expect(await mollie.getPaymentStatus?.(ctx(), 'tr_paid')).toMatchObject({
      status: 'succeeded',
      amount: { amount: 1210 },
    });
    expect(await mollie.getPaymentStatus?.(ctx(), 'tr_open')).toMatchObject({ status: 'pending' });
    expect(await mollie.getPaymentStatus?.(ctx(), 'tr_failed')).toMatchObject({ status: 'failed' });
  });
});

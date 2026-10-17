import { createModuleContext, type InvoiceDTO, type RawRequest } from '@provisia/module-sdk';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import btcpay, {
  type BtcpayConfig,
  btcpayConfigSchema,
  computeBtcpaySignature,
  summarisePaid,
} from './index.js';

const API = 'https://btcpay.test';
const SECRET = 'whsecret';
const config: BtcpayConfig = btcpayConfigSchema.parse({
  serverUrl: API,
  storeId: 'store1',
  apiKey: 'key1',
  webhookSecret: SECRET,
});
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = (overrides: Partial<BtcpayConfig> = {}) =>
  createModuleContext<BtcpayConfig>({
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

function webhook(payload: unknown, sig?: string | null): RawRequest {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const header =
    sig === null ? {} : { 'btcpay-sig': sig ?? computeBtcpaySignature(rawBody, SECRET) };
  return {
    method: 'POST',
    url: '/api/v1/public/webhooks/btcpay',
    headers: header,
    rawBody,
    body: payload,
    query: {},
  };
}

// BTC at 50,000 EUR. due 12.10 EUR = 0.000242 BTC
const invoices: Record<
  string,
  { invoice: Record<string, unknown>; methods: Record<string, unknown>[] }
> = {
  inv_settled: {
    invoice: {
      id: 'inv_settled',
      status: 'Settled',
      additionalStatus: 'None',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [
      {
        paymentMethodId: 'BTC-CHAIN',
        rate: '50000',
        amount: '0.000242',
        totalPaid: '0.000242',
        due: '0',
      },
    ],
  },
  inv_over: {
    invoice: {
      id: 'inv_over',
      status: 'Settled',
      additionalStatus: 'PaidOver',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [
      {
        paymentMethodId: 'BTC-CHAIN',
        rate: '50000',
        amount: '0.000242',
        totalPaid: '0.0003',
        due: '0',
      },
    ],
  },
  inv_partial: {
    invoice: {
      id: 'inv_partial',
      status: 'Expired',
      additionalStatus: 'PaidPartial',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [
      {
        paymentMethodId: 'BTC-LN',
        rate: '50000',
        amount: '0.000242',
        totalPaid: '0.0001',
        due: '0.000142',
      },
    ],
  },
  inv_expired: {
    invoice: {
      id: 'inv_expired',
      status: 'Expired',
      additionalStatus: 'None',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [
      {
        paymentMethodId: 'BTC-CHAIN',
        rate: '50000',
        amount: '0.000242',
        totalPaid: '0',
        due: '0.000242',
      },
    ],
  },
  inv_invalid: {
    invoice: {
      id: 'inv_invalid',
      status: 'Invalid',
      additionalStatus: 'Marked',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [],
  },
  inv_new: {
    invoice: {
      id: 'inv_new',
      status: 'New',
      additionalStatus: 'None',
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id },
    },
    methods: [],
  },
};

const calls: Array<{ method: string; path: string; body: unknown; headers: Headers }> = [];
const server = setupServer(
  http.post(`${API}/api/v1/stores/:store/invoices`, async ({ request, params }) => {
    calls.push({
      method: 'POST',
      path: `/api/v1/stores/${params.store}/invoices`,
      body: await request.json(),
      headers: request.headers,
    });
    return HttpResponse.json({ id: 'inv_new', checkoutLink: `${API}/i/inv_new` });
  }),
  http.get(`${API}/api/v1/stores/:store/invoices/:id`, ({ params }) => {
    const found = invoices[String(params.id)];
    return found
      ? HttpResponse.json(found.invoice)
      : HttpResponse.json(
          { code: 'invoice-not-found', message: 'The invoice was not found' },
          { status: 404 },
        );
  }),
  http.get(`${API}/api/v1/stores/:store/invoices/:id/payment-methods`, ({ params }) =>
    HttpResponse.json(invoices[String(params.id)]?.methods ?? []),
  ),
  http.post(`${API}/api/v1/stores/:store/invoices/:id/refund`, async ({ request, params }) => {
    calls.push({
      method: 'POST',
      path: `/api/v1/stores/${params.store}/invoices/${params.id}/refund`,
      body: await request.json(),
      headers: request.headers,
    });
    return HttpResponse.json({ id: 'pp_1', viewLink: `${API}/pull-payments/pp_1` });
  }),
  http.get(`${API}/api/v1/stores/:store`, ({ request, params }) =>
    request.headers.get('authorization') === 'token key1'
      ? HttpResponse.json({ id: params.store, name: 'Demo store' })
      : new HttpResponse(null, { status: 401 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
});
afterAll(() => server.close());

describe('btcpay gateway', () => {
  it('creates an invoice with redirect url and metadata', async () => {
    const res = await btcpay.createPayment(ctx(), invoice);
    expect(res).toEqual({ redirectUrl: `${API}/i/inv_new`, txnId: 'inv_new' });
    expect(calls[0]?.headers.get('authorization')).toBe('token key1');
    expect(calls[0]?.body).toMatchObject({
      amount: '12.10',
      currency: 'EUR',
      metadata: { orderId: invoice.id, provisiaInvoiceId: invoice.id, buyerEmail: 'c@example.com' },
      checkout: {
        redirectURL: `http://web.test/portal/invoices/${invoice.id}?payment=return`,
        redirectAutomatically: true,
      },
    });
  });

  it('rejects missing, wrong and tampered BTCPay-Sig headers', async () => {
    const event = {
      deliveryId: 'd1',
      type: 'InvoiceSettled',
      storeId: 'store1',
      invoiceId: 'inv_settled',
    };
    await expect(btcpay.handleWebhook(ctx(), webhook(event, null))).rejects.toThrow(
      /missing BTCPay-Sig/,
    );
    await expect(btcpay.handleWebhook(ctx(), webhook(event, 'sha256=00'))).rejects.toThrow(
      /does not match/,
    );
    const good = computeBtcpaySignature(Buffer.from(JSON.stringify(event)), SECRET);
    await expect(
      btcpay.handleWebhook(ctx(), webhook({ ...event, invoiceId: 'inv_over' }, good)),
    ).rejects.toThrow(/does not match/);
    await expect(
      btcpay.handleWebhook(ctx({ webhookSecret: 'other' }), webhook(event)),
    ).rejects.toThrow(/does not match/);
  });

  it('books settled invoices and is idempotent on redelivery', async () => {
    const event = {
      deliveryId: 'd1',
      type: 'InvoiceSettled',
      storeId: 'store1',
      invoiceId: 'inv_settled',
    };
    const first = await btcpay.handleWebhook(ctx(), webhook(event));
    expect(first).toMatchObject({
      kind: 'payment',
      eventId: 'd1',
      txnId: 'inv_settled',
      invoiceId: invoice.id,
      amount: { amount: 1210, currency: 'EUR' },
    });
    const redelivery = await btcpay.handleWebhook(
      ctx(),
      webhook({ ...event, deliveryId: 'd2', originalDeliveryId: 'd1', isRedelivery: true }),
    );
    expect(redelivery).toEqual(first);
  });

  it('reports overpayments as the full received value so the ledger credits the surplus', async () => {
    const res = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd3',
        type: 'InvoiceSettled',
        storeId: 'store1',
        invoiceId: 'inv_over',
        overPaid: true,
      }),
    );
    expect(res).toMatchObject({
      kind: 'payment',
      txnId: 'inv_over',
      amount: { amount: 1500, currency: 'EUR' },
      raw: { overpaid: 290 },
    });
  });

  it('books partial payments on expiry and fails unpaid/invalid invoices', async () => {
    const partial = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd4',
        type: 'InvoiceExpired',
        storeId: 'store1',
        invoiceId: 'inv_partial',
        partiallyPaid: true,
      }),
    );
    expect(partial).toMatchObject({
      kind: 'payment',
      txnId: 'inv_partial:partial',
      amount: { amount: 500 },
      raw: { partial: true },
    });
    const expired = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd5',
        type: 'InvoiceExpired',
        storeId: 'store1',
        invoiceId: 'inv_expired',
      }),
    );
    expect(expired).toMatchObject({ kind: 'failed', txnId: 'inv_expired', reason: /expired/ });
    const invalid = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd6',
        type: 'InvoiceInvalid',
        storeId: 'store1',
        invoiceId: 'inv_invalid',
      }),
    );
    expect(invalid).toMatchObject({ kind: 'failed', reason: /invalid/ });
    const processing = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd7',
        type: 'InvoiceProcessing',
        storeId: 'store1',
        invoiceId: 'inv_new',
      }),
    );
    expect(processing).toMatchObject({ kind: 'ignored' });
    const otherStore = await btcpay.handleWebhook(
      ctx(),
      webhook({
        deliveryId: 'd8',
        type: 'InvoiceSettled',
        storeId: 'store2',
        invoiceId: 'inv_settled',
      }),
    );
    expect(otherStore).toMatchObject({ kind: 'ignored' });
  });

  it('summarises paid value across payment methods', () => {
    const s = summarisePaid({ amount: '10.00', currency: 'EUR' }, [
      { paymentMethodId: 'BTC-CHAIN', totalPaid: '0.0001', rate: '50000' },
      { paymentMethodId: 'BTC-LN', totalPaid: '0.00002', rate: '50000' },
    ]);
    expect(s).toEqual({
      paid: { amount: 600, currency: 'EUR' },
      due: { amount: 1000, currency: 'EUR' },
      paymentMethods: ['BTC-CHAIN', 'BTC-LN'],
    });
  });

  it('refunds through a pull payment', async () => {
    const res = await btcpay.refund?.(
      ctx(),
      {
        id: 'tx-1',
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        gateway: 'btcpay',
        gatewayTxnId: 'inv_settled',
        type: 'payment',
        amount: 1210,
        fee: 0,
        currency: 'EUR',
        description: null,
        createdAt: new Date(),
      },
      { amount: 1210, currency: 'EUR' },
    );
    expect(res).toEqual({
      refundTxnId: 'pp_1',
      amount: { amount: 1210, currency: 'EUR' },
      status: 'pending',
    });
    expect(calls[0]).toMatchObject({
      path: '/api/v1/stores/store1/invoices/inv_settled/refund',
      body: {
        paymentMethod: 'BTC-CHAIN',
        refundVariant: 'Custom',
        customAmount: '12.10',
        customCurrency: 'EUR',
      },
    });
  });

  it('tests credentials and polls status', async () => {
    expect(await btcpay.testCredentials?.(ctx())).toMatchObject({
      ok: true,
      message: /Demo store/,
    });
    expect(await btcpay.testCredentials?.(ctx({ apiKey: 'bad' }))).toMatchObject({ ok: false });
    expect(await btcpay.getPaymentStatus?.(ctx(), 'inv_settled')).toMatchObject({
      status: 'succeeded',
      amount: { amount: 1210 },
    });
    expect(await btcpay.getPaymentStatus?.(ctx(), 'inv_new')).toMatchObject({
      status: 'pending',
      invoiceId: invoice.id,
    });
    expect(await btcpay.getPaymentStatus?.(ctx(), 'inv_expired')).toMatchObject({
      status: 'expired',
    });
  });
});

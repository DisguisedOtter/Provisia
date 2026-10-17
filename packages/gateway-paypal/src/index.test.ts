import { createModuleContext, type InvoiceDTO, type RawRequest } from '@provisia/module-sdk';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import paypal, {
  type PaypalConfig,
  paypalBaseUrl,
  paypalConfigSchema,
  resetTokenCache,
} from './index.js';

const API = 'https://paypal.test';
const config: PaypalConfig = paypalConfigSchema.parse({
  clientId: 'cid',
  clientSecret: 'csecret',
  mode: 'sandbox',
  webhookId: 'WH-1',
  apiBaseUrl: API,
});
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = (overrides: Partial<PaypalConfig> = {}) =>
  createModuleContext<PaypalConfig>({
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

const capture = {
  id: 'CAP-1',
  status: 'COMPLETED',
  custom_id: invoice.id,
  amount: { currency_code: 'EUR', value: '12.10' },
  seller_receivable_breakdown: { paypal_fee: { currency_code: 'EUR', value: '0.59' } },
};

const validHeaders = {
  'paypal-transmission-id': 'tid',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-10-17T00:00:00Z',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
};

function rawRequest(payload: unknown, headers: Record<string, string> = validHeaders): RawRequest {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    method: 'POST',
    url: '/api/v1/public/webhooks/paypal',
    headers,
    rawBody,
    body: payload,
    query: {},
  };
}

const calls: Array<{ path: string; body: unknown; headers: Headers }> = [];
let captured = false;
const server = setupServer(
  http.post(`${API}/v1/oauth2/token`, ({ request }) => {
    const auth = request.headers.get('authorization');
    if (auth !== `Basic ${Buffer.from('cid:csecret').toString('base64')}`) {
      return HttpResponse.json(
        { error: 'invalid_client', error_description: 'Client Authentication failed' },
        { status: 401 },
      );
    }
    return HttpResponse.json({ access_token: 'tok', expires_in: 3600 });
  }),
  http.post(`${API}/v2/checkout/orders`, async ({ request }) => {
    calls.push({
      path: '/v2/checkout/orders',
      body: await request.json(),
      headers: request.headers,
    });
    return HttpResponse.json({
      id: 'ORDER-1',
      status: 'PAYER_ACTION_REQUIRED',
      links: [
        { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' },
      ],
    });
  }),
  http.post(`${API}/v2/checkout/orders/:id/capture`, async ({ request, params }) => {
    calls.push({
      path: `/v2/checkout/orders/${params.id}/capture`,
      body: null,
      headers: request.headers,
    });
    if (captured) {
      return HttpResponse.json(
        {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Order already captured.' }],
        },
        { status: 422 },
      );
    }
    captured = true;
    return HttpResponse.json({
      id: params.id,
      status: 'COMPLETED',
      purchase_units: [{ custom_id: invoice.id, payments: { captures: [capture] } }],
    });
  }),
  http.get(`${API}/v2/checkout/orders/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      status: 'COMPLETED',
      purchase_units: [{ custom_id: invoice.id, payments: { captures: [capture] } }],
    }),
  ),
  http.post(`${API}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
    const text = await request.text();
    calls.push({
      path: '/v1/notifications/verify-webhook-signature',
      body: text,
      headers: request.headers,
    });
    const parsed = JSON.parse(text) as { transmission_sig: string; webhook_id: string };
    const ok = parsed.transmission_sig === 'sig' && parsed.webhook_id === 'WH-1';
    return HttpResponse.json({ verification_status: ok ? 'SUCCESS' : 'FAILURE' });
  }),
  http.post(`${API}/v2/payments/captures/:id/refund`, async ({ request, params }) => {
    const body = (await request.json()) as { amount: { value: string; currency_code: string } };
    calls.push({
      path: `/v2/payments/captures/${params.id}/refund`,
      body,
      headers: request.headers,
    });
    return HttpResponse.json({ id: 'REF-1', status: 'COMPLETED', amount: body.amount });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  resetTokenCache();
  captured = false;
});
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
});
afterAll(() => server.close());

describe('paypal gateway', () => {
  it('derives the base url from mode', () => {
    expect(paypalBaseUrl({ ...config, apiBaseUrl: undefined })).toBe(
      'https://api-m.sandbox.paypal.com',
    );
    expect(paypalBaseUrl({ ...config, apiBaseUrl: undefined, mode: 'live' })).toBe(
      'https://api-m.paypal.com',
    );
  });

  it('creates an order and returns the approval link', async () => {
    const res = await paypal.createPayment(ctx(), invoice);
    expect(res).toEqual({
      redirectUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
      txnId: 'ORDER-1',
    });
    const body = calls[0]?.body as {
      intent: string;
      purchase_units: Array<Record<string, unknown>>;
      payment_source: Record<string, unknown>;
    };
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0]).toMatchObject({
      custom_id: invoice.id,
      amount: { currency_code: 'EUR', value: '12.10' },
    });
    const exp = (body.payment_source.paypal as { experience_context: Record<string, string> })
      .experience_context;
    expect(exp.return_url).toBe(
      `http://api.test/api/v1/public/payments/paypal/return?invoice=${invoice.id}`,
    );
    expect(calls[0]?.headers.get('paypal-request-id')).toContain(invoice.id);
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer tok');
  });

  it('rejects webhooks whose signature PayPal does not verify, or with missing headers', async () => {
    const event = { id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: capture };
    await expect(paypal.handleWebhook(ctx(), rawRequest(event, {}))).rejects.toThrow(
      /missing PayPal transmission headers/,
    );
    await expect(
      paypal.handleWebhook(
        ctx(),
        rawRequest(event, { ...validHeaders, 'paypal-transmission-sig': 'bad' }),
      ),
    ).rejects.toThrow(/verification failed/);
    await expect(
      paypal.handleWebhook(ctx({ webhookId: 'WH-other' }), rawRequest(event)),
    ).rejects.toThrow(/verification failed/);
  });

  it('embeds the raw event bytes in the verification request and maps capture completed', async () => {
    const event = { id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: capture };
    const res = await paypal.handleWebhook(ctx(), rawRequest(event));
    expect(res).toMatchObject({
      kind: 'payment',
      eventId: 'WH-EVT-1',
      txnId: 'CAP-1',
      invoiceId: invoice.id,
      amount: { amount: 1210, currency: 'EUR' },
      fee: { amount: 59, currency: 'EUR' },
    });
    const verify = calls.find((c) => c.path.endsWith('verify-webhook-signature'));
    expect(String(verify?.body)).toContain(`"webhook_event":${JSON.stringify(event)}`);
    // Replaying the same delivery yields the same result (the ledger dedupes on txn id / event id).
    expect(await paypal.handleWebhook(ctx(), rawRequest(event))).toEqual(res);
  });

  it('captures on CHECKOUT.ORDER.APPROVED and tolerates ORDER_ALREADY_CAPTURED', async () => {
    const event = {
      id: 'WH-EVT-2',
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: { id: 'ORDER-1', status: 'APPROVED' },
    };
    const first = await paypal.handleWebhook(ctx(), rawRequest(event));
    expect(first).toMatchObject({ kind: 'payment', txnId: 'CAP-1', invoiceId: invoice.id });
    const second = await paypal.handleWebhook(ctx(), rawRequest(event));
    expect(second).toMatchObject({ kind: 'payment', txnId: 'CAP-1' });
    expect(calls.filter((c) => c.path.endsWith('/capture'))).toHaveLength(2);
  });

  it('maps denied captures and refunds', async () => {
    const denied = await paypal.handleWebhook(
      ctx(),
      rawRequest({
        id: 'WH-EVT-3',
        event_type: 'PAYMENT.CAPTURE.DENIED',
        resource: { ...capture, status: 'DENIED', status_details: { reason: 'RISK' } },
      }),
    );
    expect(denied).toMatchObject({
      kind: 'failed',
      txnId: 'CAP-1',
      invoiceId: invoice.id,
      reason: 'RISK',
    });
    const refunded = await paypal.handleWebhook(
      ctx(),
      rawRequest({
        id: 'WH-EVT-4',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'REF-9',
          status: 'COMPLETED',
          amount: { currency_code: 'EUR', value: '5.00' },
          links: [{ rel: 'up', href: `${API}/v2/payments/captures/CAP-1` }],
        },
      }),
    );
    expect(refunded).toMatchObject({
      kind: 'refund',
      txnId: 'REF-9',
      originalTxnId: 'CAP-1',
      amount: { amount: 500 },
    });
    const other = await paypal.handleWebhook(
      ctx(),
      rawRequest({ id: 'WH-EVT-5', event_type: 'BILLING.PLAN.CREATED', resource: {} }),
    );
    expect(other).toMatchObject({ kind: 'ignored' });
  });

  it('captures on browser return and redirects to the invoice', async () => {
    const res = await paypal.handleReturn?.(ctx(), {
      method: 'GET',
      url: '/api/v1/public/payments/paypal/return',
      headers: {},
      rawBody: Buffer.alloc(0),
      body: undefined,
      query: { token: 'ORDER-1', PayerID: 'P1', invoice: invoice.id },
    });
    expect(res?.redirectUrl).toBe(`http://web.test/portal/invoices/${invoice.id}?payment=success`);
    expect(res?.result).toMatchObject({ kind: 'payment', txnId: 'CAP-1' });
  });

  it('refunds a capture', async () => {
    const res = await paypal.refund?.(
      ctx(),
      {
        id: 'tx-1',
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        gateway: 'paypal',
        gatewayTxnId: 'CAP-1',
        type: 'payment',
        amount: 1210,
        fee: 59,
        currency: 'EUR',
        description: null,
        createdAt: new Date(),
      },
      { amount: 250, currency: 'EUR' },
    );
    expect(res).toEqual({
      refundTxnId: 'REF-1',
      amount: { amount: 250, currency: 'EUR' },
      status: 'completed',
    });
    expect(calls[0]).toMatchObject({
      path: '/v2/payments/captures/CAP-1/refund',
      body: { amount: { value: '2.50', currency_code: 'EUR' } },
    });
  });

  it('tests credentials and reports order status', async () => {
    expect(await paypal.testCredentials?.(ctx())).toMatchObject({ ok: true });
    expect(await paypal.testCredentials?.(ctx({ clientSecret: 'nope' }))).toMatchObject({
      ok: false,
      message: /Authentication failed/,
    });
    expect(await paypal.getPaymentStatus?.(ctx(), 'ORDER-1')).toMatchObject({
      status: 'succeeded',
      txnId: 'CAP-1',
      amount: { amount: 1210 },
    });
  });
});

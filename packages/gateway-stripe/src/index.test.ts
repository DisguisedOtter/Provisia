import { createModuleContext, type InvoiceDTO, type RawRequest } from '@provisia/module-sdk';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import stripe, { type StripeConfig, stripeConfigSchema } from './index.js';
import { signPayload } from './signature.js';

const API = 'https://stripe.test';
const WEBHOOK_SECRET = 'whsec_testsecret';

const config: StripeConfig = stripeConfigSchema.parse({
  secretKey: 'sk_test_123',
  publishableKey: 'pk_test_123',
  webhookSecret: WEBHOOK_SECRET,
  apiBaseUrl: API,
});

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = (overrides: Partial<StripeConfig> = {}) =>
  createModuleContext<StripeConfig>({
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
    email: 'client@example.com',
    name: 'Jane Client',
    companyName: null,
    country: 'NL',
  },
};

function rawRequest(payload: unknown, header: string | undefined): RawRequest {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    method: 'POST',
    url: '/api/v1/public/webhooks/stripe',
    headers: header === undefined ? {} : { 'stripe-signature': header },
    rawBody,
    body: payload,
    query: {},
  };
}

const signed = (payload: unknown) =>
  rawRequest(payload, signPayload(JSON.stringify(payload), WEBHOOK_SECRET));

const requests: Array<{ method: string; path: string; body: URLSearchParams; headers: Headers }> =
  [];
const server = setupServer(
  http.post(`${API}/v1/checkout/sessions`, async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    requests.push({
      method: 'POST',
      path: '/v1/checkout/sessions',
      body,
      headers: request.headers,
    });
    return HttpResponse.json({
      id: body.get('mode') === 'setup' ? 'cs_setup_1' : 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      payment_intent: 'pi_1',
    });
  }),
  http.post(`${API}/v1/payment_intents`, async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    requests.push({ method: 'POST', path: '/v1/payment_intents', body, headers: request.headers });
    if (body.get('payment_method') === 'pm_declined') {
      return HttpResponse.json(
        {
          error: {
            type: 'card_error',
            code: 'card_declined',
            message: 'Your card was declined.',
            payment_intent: { id: 'pi_declined' },
          },
        },
        { status: 402 },
      );
    }
    if (body.get('confirm') === 'true') {
      return HttpResponse.json({ id: 'pi_auto_1', status: 'succeeded', latest_charge: 'ch_1' });
    }
    return HttpResponse.json({ id: 'pi_elements_1', client_secret: 'pi_elements_1_secret_x' });
  }),
  http.post(`${API}/v1/refunds`, async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    requests.push({ method: 'POST', path: '/v1/refunds', body, headers: request.headers });
    return HttpResponse.json({
      id: 're_1',
      amount: Number(body.get('amount')),
      currency: 'eur',
      status: 'succeeded',
    });
  }),
  http.post(`${API}/v1/customers`, () => HttpResponse.json({ id: 'cus_1' })),
  http.get(`${API}/v1/charges/:id`, () =>
    HttpResponse.json({ id: 'ch_1', balance_transaction: { fee: 35, currency: 'eur' } }),
  ),
  http.get(`${API}/v1/payment_methods/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      type: 'card',
      customer: 'cus_1',
      card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 },
    }),
  ),
  http.get(`${API}/v1/balance`, ({ request }) =>
    request.headers.get('authorization') === 'Bearer sk_test_123'
      ? HttpResponse.json({ object: 'balance', livemode: false })
      : HttpResponse.json({ error: { message: 'Invalid API Key provided' } }, { status: 401 }),
  ),
  http.get(`${API}/v1/checkout/sessions/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 1210,
      currency: 'eur',
      metadata: { invoice_id: invoice.id },
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => server.close());

describe('stripe gateway', () => {
  it('creates a Checkout Session with the configured payment methods and invoice metadata', async () => {
    const res = await stripe.createPayment(ctx(), invoice);
    expect(res).toEqual({
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      txnId: 'cs_test_1',
    });
    const body = requests[0]?.body;
    expect(body?.get('mode')).toBe('payment');
    expect(body?.getAll('payment_method_types[0]')).toEqual(['card']);
    expect(body?.get('payment_method_types[1]')).toBe('sepa_debit');
    expect(body?.get('payment_method_types[2]')).toBe('ideal');
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('1210');
    expect(body?.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(body?.get('metadata[invoice_id]')).toBe(invoice.id);
    expect(body?.get('payment_intent_data[metadata][invoice_id]')).toBe(invoice.id);
    expect(body?.get('success_url')).toContain(`http://web.test/portal/invoices/${invoice.id}`);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer sk_test_123');
  });

  it('creates a Payment Intent and returns the client secret in payment_intent flow', async () => {
    const res = await stripe.createPayment(ctx({ flow: 'payment_intent' }), invoice);
    expect(res).toEqual({ clientSecret: 'pi_elements_1_secret_x', txnId: 'pi_elements_1' });
    expect(requests[0]?.body.get('amount')).toBe('1210');
    expect(requests[0]?.headers.get('idempotency-key')).toContain(invoice.id);
  });

  it('rejects webhooks with a missing or invalid signature', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } };
    await expect(stripe.handleWebhook(ctx(), rawRequest(event, undefined))).rejects.toThrow(
      /missing stripe-signature/,
    );
    await expect(
      stripe.handleWebhook(
        ctx(),
        rawRequest(event, signPayload(JSON.stringify(event), 'whsec_other')),
      ),
    ).rejects.toThrow(/does not match/);
    const stale = signPayload(
      JSON.stringify(event),
      WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000) - 3600,
    );
    await expect(stripe.handleWebhook(ctx(), rawRequest(event, stale))).rejects.toThrow(
      /tolerance/,
    );
    // Tampered body with a signature for the original payload.
    const sig = signPayload(JSON.stringify(event), WEBHOOK_SECRET);
    const tampered = rawRequest({ ...event, id: 'evt_2' }, sig);
    await expect(stripe.handleWebhook(ctx(), tampered)).rejects.toThrow(/does not match/);
  });

  it('maps payment_intent.succeeded to a payment with fee and is idempotent on replay', async () => {
    const event = {
      id: 'evt_pi_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount: 1210,
          amount_received: 1210,
          currency: 'eur',
          latest_charge: 'ch_1',
          metadata: { invoice_id: invoice.id },
        },
      },
    };
    const first = await stripe.handleWebhook(ctx(), signed(event));
    expect(first).toMatchObject({
      kind: 'payment',
      eventId: 'evt_pi_1',
      txnId: 'pi_1',
      invoiceId: invoice.id,
      amount: { amount: 1210, currency: 'EUR' },
      fee: { amount: 35, currency: 'EUR' },
    });
    const replay = await stripe.handleWebhook(ctx(), signed(event));
    expect(replay).toEqual(first);
  });

  it('maps checkout.session.completed to the same payment intent txn id', async () => {
    const event = {
      id: 'evt_cs_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_1',
          amount_total: 1210,
          currency: 'eur',
          metadata: { invoice_id: invoice.id },
        },
      },
    };
    const res = await stripe.handleWebhook(ctx(), signed(event));
    expect(res).toMatchObject({ kind: 'payment', txnId: 'pi_1', invoiceId: invoice.id });
    const unpaid = {
      ...event,
      id: 'evt_cs_2',
      data: { object: { ...event.data.object, payment_status: 'unpaid' } },
    };
    expect(await stripe.handleWebhook(ctx(), signed(unpaid))).toMatchObject({ kind: 'ignored' });
  });

  it('maps payment_intent.payment_failed, charge.refunded and setup_intent.succeeded', async () => {
    const failed = await stripe.handleWebhook(
      ctx(),
      signed({
        id: 'evt_f',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_f',
            metadata: { invoice_id: invoice.id },
            last_payment_error: { message: 'Insufficient funds', code: 'card_declined' },
          },
        },
      }),
    );
    expect(failed).toMatchObject({ kind: 'failed', txnId: 'pi_f', reason: 'Insufficient funds' });

    const refunded = await stripe.handleWebhook(
      ctx(),
      signed({
        id: 'evt_r',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: 'pi_1',
            refunds: {
              data: [
                { id: 're_old', amount: 100, currency: 'eur', created: 1 },
                { id: 're_new', amount: 500, currency: 'eur', created: 2 },
              ],
            },
          },
        },
      }),
    );
    expect(refunded).toMatchObject({
      kind: 'refund',
      txnId: 're_new',
      originalTxnId: 'pi_1',
      amount: { amount: 500, currency: 'EUR' },
    });

    const setup = await stripe.handleWebhook(
      ctx(),
      signed({
        id: 'evt_s',
        type: 'setup_intent.succeeded',
        data: {
          object: {
            id: 'seti_1',
            customer: 'cus_1',
            payment_method: 'pm_1',
            metadata: { client_id: invoice.client.id },
          },
        },
      }),
    );
    expect(setup).toMatchObject({
      kind: 'setup_completed',
      setupId: 'seti_1',
      clientId: invoice.client.id,
      method: {
        type: 'card',
        gatewayCustomerId: 'cus_1',
        gatewayMethodId: 'pm_1',
        label: 'Visa •••• 4242',
        expiresAt: '2030-04',
      },
    });

    const unknown = await stripe.handleWebhook(
      ctx(),
      signed({ id: 'evt_u', type: 'customer.created', data: { object: {} } }),
    );
    expect(unknown).toMatchObject({ kind: 'ignored', eventId: 'evt_u' });
  });

  it('refunds a payment intent', async () => {
    const res = await stripe.refund?.(
      ctx(),
      {
        id: 'tx-1',
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        gateway: 'stripe',
        gatewayTxnId: 'pi_1',
        type: 'payment',
        amount: 1210,
        fee: 35,
        currency: 'EUR',
        description: null,
        createdAt: new Date(),
      },
      { amount: 500, currency: 'EUR' },
    );
    expect(res).toEqual({
      refundTxnId: 're_1',
      amount: { amount: 500, currency: 'EUR' },
      status: 'completed',
    });
    expect(requests[0]?.body.get('payment_intent')).toBe('pi_1');
    expect(requests[0]?.body.get('amount')).toBe('500');
  });

  it('creates a setup session and charges a saved method off-session', async () => {
    const setup = await stripe.createSetup?.(ctx(), {
      client: { id: invoice.client.id, email: invoice.client.email, name: 'Jane' },
      gatewayCustomerId: null,
      returnUrl: 'http://web.test/portal/billing/methods',
    });
    expect(setup).toMatchObject({ setupId: 'cs_setup_1', gatewayCustomerId: 'cus_1' });
    expect(requests[0]?.body.get('mode')).toBe('setup');
    expect(requests[0]?.body.get('setup_intent_data[metadata][client_id]')).toBe(invoice.client.id);

    const method = {
      id: 'pm-row-1',
      clientId: invoice.clientId,
      gateway: 'stripe',
      type: 'card',
      gatewayCustomerId: 'cus_1',
      gatewayMethodId: 'pm_1',
      label: 'Visa •••• 4242',
      expiresAt: '2030-04',
      isDefault: true,
      status: 'active' as const,
      details: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const charge = await stripe.chargeSavedMethod?.(ctx(), invoice, method);
    expect(charge).toMatchObject({ txnId: 'pi_auto_1', status: 'succeeded', fee: { amount: 35 } });
    const body = requests[1]?.body;
    expect(body?.get('off_session')).toBe('true');
    expect(body?.get('confirm')).toBe('true');
    expect(body?.get('customer')).toBe('cus_1');

    const declined = await stripe.chargeSavedMethod?.(ctx(), invoice, {
      ...method,
      gatewayMethodId: 'pm_declined',
    });
    expect(declined).toEqual({
      txnId: 'pi_declined',
      status: 'failed',
      reason: 'Your card was declined.',
    });
  });

  it('tests credentials and polls payment status', async () => {
    expect(await stripe.testCredentials?.(ctx())).toMatchObject({ ok: true });
    expect(await stripe.testCredentials?.(ctx({ secretKey: 'sk_test_wrong' }))).toMatchObject({
      ok: false,
      message: /Invalid API Key/,
    });
    expect(await stripe.getPaymentStatus?.(ctx(), 'cs_test_1')).toMatchObject({
      status: 'succeeded',
      txnId: 'pi_1',
      invoiceId: invoice.id,
      amount: { amount: 1210, currency: 'EUR' },
    });
  });
});

import {
  type ChargeResult,
  defineGateway,
  type GatewayContext,
  type InvoiceDTO,
  type Money,
  type PaymentMethodDTO,
  type PaymentStatusResult,
  type RawRequest,
  type RefundResult,
  type SavedMethodInput,
  type SetupRequest,
  type SetupResult,
  type TransactionDTO,
  type WebhookResult,
} from '@provisia/module-sdk';
import { SETUP_CAPABLE_METHODS, type StripeConfig, stripeConfigSchema } from './config.js';
import { StripeApiError, stripeRequest } from './http.js';
import { verifyStripeSignature } from './signature.js';

export { type StripeConfig, stripeConfigSchema } from './config.js';
export { StripeApiError } from './http.js';
export { StripeSignatureError, signPayload, verifyStripeSignature } from './signature.js';

type Ctx = GatewayContext<StripeConfig>;
type Obj = Record<string, unknown>;

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Obj };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

function invoiceLabel(invoice: InvoiceDTO): string {
  return invoice.number ? `Invoice ${invoice.number}` : `Invoice ${invoice.id.slice(0, 8)}`;
}

function portalInvoiceUrl(ctx: Ctx, invoice: InvoiceDTO, state: string): string {
  return `${ctx.webUrl.replace(/\/$/, '')}/portal/invoices/${invoice.id}?payment=${state}`;
}

function describeMethod(pm: Obj): SavedMethodInput {
  const type = str(pm.type) ?? 'card';
  const base = {
    type,
    gatewayCustomerId: str(pm.customer) ?? null,
    gatewayMethodId: str(pm.id) ?? '',
  };
  if (type === 'card') {
    const card = obj(pm.card);
    const brand = str(card.brand) ?? 'card';
    const month = String(num(card.exp_month)).padStart(2, '0');
    return {
      ...base,
      label: `${brand.charAt(0).toUpperCase()}${brand.slice(1)} •••• ${str(card.last4) ?? '????'}`,
      expiresAt: card.exp_year ? `${num(card.exp_year)}-${month}` : null,
      details: { brand, last4: card.last4, funding: card.funding, country: card.country },
    };
  }
  if (type === 'sepa_debit') {
    const sepa = obj(pm.sepa_debit);
    return {
      ...base,
      label: `SEPA ${str(sepa.country) ?? ''}•• •••• ${str(sepa.last4) ?? '????'}`.replace(
        '  ',
        ' ',
      ),
      expiresAt: null,
      details: { last4: sepa.last4, bankCode: sepa.bank_code, country: sepa.country },
    };
  }
  return { ...base, label: type, expiresAt: null, details: {} };
}

/** Best effort: Stripe fee from the charge's balance transaction. Never fails the webhook. */
async function fetchFee(ctx: Ctx, chargeId: string | undefined): Promise<Money | undefined> {
  if (!chargeId) return undefined;
  try {
    const charge = await stripeRequest<Obj>(ctx, 'GET', `/v1/charges/${chargeId}`, {
      expand: ['balance_transaction'],
    });
    const bt = obj(charge.balance_transaction);
    if (typeof bt.fee === 'number') {
      return { amount: bt.fee, currency: (str(bt.currency) ?? 'eur').toUpperCase() };
    }
  } catch (err) {
    ctx.logger.warn({ err, chargeId }, 'stripe: could not fetch fee');
  }
  return undefined;
}

function mapIntentStatus(pi: Obj): PaymentStatusResult {
  const status = str(pi.status);
  const amount: Money = {
    amount: num(pi.amount_received) || num(pi.amount),
    currency: (str(pi.currency) ?? 'eur').toUpperCase(),
  };
  const invoiceId = str(obj(pi.metadata).invoice_id);
  const txnId = str(pi.id);
  if (status === 'succeeded') return { status: 'succeeded', txnId, invoiceId, amount };
  if (status === 'canceled') return { status: 'expired', txnId, invoiceId, reason: 'canceled' };
  const lastError = obj(pi.last_payment_error);
  if (status === 'requires_payment_method' && lastError.message) {
    return { status: 'failed', txnId, invoiceId, reason: String(lastError.message) };
  }
  return { status: 'pending', txnId, invoiceId };
}

const stripe = defineGateway({
  id: 'stripe',
  name: 'Stripe',
  version: '1.0.0',
  configSchema: stripeConfigSchema,
  capabilities: { refunds: true, savedMethods: true, recurring: true },

  async createPayment(ctx, invoice) {
    const amount = invoice.total;
    const currency = invoice.currency.toLowerCase();
    if (ctx.config.flow === 'payment_intent') {
      const pi = await stripeRequest<Obj>(
        ctx,
        'POST',
        '/v1/payment_intents',
        {
          amount,
          currency,
          payment_method_types: ctx.config.paymentMethods,
          description: invoiceLabel(invoice),
          receipt_email: invoice.client.email,
          metadata: { invoice_id: invoice.id, client_id: invoice.client.id },
          statement_descriptor_suffix: ctx.config.statementDescriptor,
        },
        { idempotencyKey: `provisia:pi:${invoice.id}:${amount}` },
      );
      return { clientSecret: str(pi.client_secret), txnId: String(pi.id) };
    }
    const session = await stripeRequest<Obj>(ctx, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      payment_method_types: ctx.config.paymentMethods,
      client_reference_id: invoice.id,
      customer_email: invoice.client.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amount,
            product_data: { name: invoiceLabel(invoice) },
          },
        },
      ],
      metadata: { invoice_id: invoice.id, client_id: invoice.client.id },
      payment_intent_data: {
        description: invoiceLabel(invoice),
        metadata: { invoice_id: invoice.id, client_id: invoice.client.id },
        statement_descriptor_suffix: ctx.config.statementDescriptor,
      },
      success_url: `${portalInvoiceUrl(ctx, invoice, 'success')}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: portalInvoiceUrl(ctx, invoice, 'cancelled'),
    });
    return { redirectUrl: str(session.url), txnId: String(session.id) };
  },

  async handleWebhook(ctx, req: RawRequest): Promise<WebhookResult> {
    const header = req.headers['stripe-signature'];
    verifyStripeSignature(
      req.rawBody,
      Array.isArray(header) ? header[0] : header,
      ctx.config.webhookSecret,
      ctx.config.webhookToleranceSeconds,
    );
    const event = JSON.parse(req.rawBody.toString('utf8')) as StripeEvent;
    const object = event.data?.object ?? {};
    const eventId = event.id;

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const invoiceId = str(obj(object.metadata).invoice_id);
        if (!invoiceId)
          return { kind: 'ignored', eventId, reason: 'payment_intent without invoice_id' };
        return {
          kind: 'payment',
          eventId,
          txnId: String(object.id),
          invoiceId,
          amount: {
            amount: num(object.amount_received) || num(object.amount),
            currency: (str(object.currency) ?? 'eur').toUpperCase(),
          },
          fee: await fetchFee(ctx, str(object.latest_charge)),
          raw: { eventType: event.type, customer: object.customer ?? null },
        };
      }
      case 'payment_intent.payment_failed': {
        const err = obj(object.last_payment_error);
        return {
          kind: 'failed',
          eventId,
          txnId: String(object.id),
          invoiceId: str(obj(object.metadata).invoice_id),
          reason: str(err.message) ?? str(err.code) ?? 'payment failed',
          raw: { eventType: event.type, code: err.code ?? null },
        };
      }
      case 'checkout.session.completed': {
        if (object.mode !== 'payment') {
          return {
            kind: 'ignored',
            eventId,
            reason: `checkout session mode ${String(object.mode)}`,
          };
        }
        if (object.payment_status !== 'paid') {
          // Delayed notification methods (SEPA): payment_intent.succeeded will follow.
          return { kind: 'ignored', eventId, reason: 'checkout session not yet paid' };
        }
        const invoiceId = str(obj(object.metadata).invoice_id) ?? str(object.client_reference_id);
        if (!invoiceId)
          return { kind: 'ignored', eventId, reason: 'checkout session without invoice_id' };
        return {
          kind: 'payment',
          eventId,
          txnId: str(object.payment_intent) ?? String(object.id),
          invoiceId,
          amount: {
            amount: num(object.amount_total),
            currency: (str(object.currency) ?? 'eur').toUpperCase(),
          },
          raw: { eventType: event.type, sessionId: object.id, customer: object.customer ?? null },
        };
      }
      case 'charge.refunded': {
        const refunds = (obj(object.refunds).data as Obj[] | undefined) ?? [];
        const latest = [...refunds].sort((a, b) => num(b.created) - num(a.created))[0];
        if (!latest) return { kind: 'ignored', eventId, reason: 'charge.refunded without refunds' };
        return {
          kind: 'refund',
          eventId,
          txnId: String(latest.id),
          originalTxnId: str(object.payment_intent) ?? String(object.id),
          amount: {
            amount: num(latest.amount),
            currency: (str(latest.currency) ?? 'eur').toUpperCase(),
          },
          raw: { eventType: event.type, chargeId: object.id, reason: latest.reason ?? null },
        };
      }
      case 'setup_intent.succeeded': {
        const clientId = str(obj(object.metadata).client_id);
        const pmId = str(object.payment_method);
        if (!clientId || !pmId) {
          return {
            kind: 'ignored',
            eventId,
            reason: 'setup_intent without client_id/payment_method',
          };
        }
        const pm = await stripeRequest<Obj>(ctx, 'GET', `/v1/payment_methods/${pmId}`);
        const method = describeMethod(pm);
        method.gatewayCustomerId ??= str(object.customer) ?? null;
        return {
          kind: 'setup_completed',
          eventId,
          setupId: String(object.id),
          clientId,
          method,
          raw: { eventType: event.type },
        };
      }
      default:
        return { kind: 'ignored', eventId, reason: `unhandled event ${event.type}` };
    }
  },

  async refund(ctx: Ctx, txn: TransactionDTO, amount: Money): Promise<RefundResult> {
    const id = txn.gatewayTxnId ?? '';
    const target = id.startsWith('pi_') ? { payment_intent: id } : { charge: id };
    const refund = await stripeRequest<Obj>(
      ctx,
      'POST',
      '/v1/refunds',
      { ...target, amount: amount.amount, metadata: { transaction_id: txn.id } },
      { idempotencyKey: `provisia:refund:${txn.id}:${amount.amount}` },
    );
    return {
      refundTxnId: String(refund.id),
      amount: {
        amount: num(refund.amount),
        currency: (str(refund.currency) ?? 'eur').toUpperCase(),
      },
      status: refund.status === 'succeeded' ? 'completed' : 'pending',
    };
  },

  async testCredentials(ctx: Ctx) {
    try {
      const balance = await stripeRequest<Obj>(ctx, 'GET', '/v1/balance');
      return { ok: true, message: `Connected (livemode=${String(balance.livemode)})` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async getPaymentStatus(ctx: Ctx, txnId: string): Promise<PaymentStatusResult> {
    if (txnId.startsWith('cs_')) {
      const session = await stripeRequest<Obj>(ctx, 'GET', `/v1/checkout/sessions/${txnId}`);
      const invoiceId = str(obj(session.metadata).invoice_id) ?? str(session.client_reference_id);
      if (session.payment_status === 'paid') {
        return {
          status: 'succeeded',
          txnId: str(session.payment_intent) ?? txnId,
          invoiceId,
          amount: {
            amount: num(session.amount_total),
            currency: (str(session.currency) ?? 'eur').toUpperCase(),
          },
        };
      }
      if (session.status === 'expired')
        return { status: 'expired', invoiceId, reason: 'session expired' };
      return { status: 'pending', invoiceId };
    }
    const pi = await stripeRequest<Obj>(ctx, 'GET', `/v1/payment_intents/${txnId}`);
    return mapIntentStatus(pi);
  },

  async createSetup(ctx: Ctx, req: SetupRequest): Promise<SetupResult> {
    let customerId = req.gatewayCustomerId;
    if (!customerId) {
      const customer = await stripeRequest<Obj>(ctx, 'POST', '/v1/customers', {
        email: req.client.email,
        name: req.client.name,
        metadata: { client_id: req.client.id },
      });
      customerId = String(customer.id);
    }
    const methods = ctx.config.paymentMethods.filter((m) => SETUP_CAPABLE_METHODS.has(m));
    const joiner = req.returnUrl.includes('?') ? '&' : '?';
    const session = await stripeRequest<Obj>(ctx, 'POST', '/v1/checkout/sessions', {
      mode: 'setup',
      customer: customerId,
      payment_method_types: methods.length ? methods : ['card'],
      setup_intent_data: { metadata: { client_id: req.client.id } },
      metadata: { client_id: req.client.id },
      success_url: `${req.returnUrl}${joiner}setup=success`,
      cancel_url: `${req.returnUrl}${joiner}setup=cancelled`,
    });
    return {
      redirectUrl: str(session.url),
      setupId: String(session.id),
      gatewayCustomerId: customerId,
    };
  },

  async chargeSavedMethod(
    ctx: Ctx,
    invoice: InvoiceDTO,
    method: PaymentMethodDTO,
  ): Promise<ChargeResult> {
    const day = new Date().toISOString().slice(0, 10);
    try {
      const pi = await stripeRequest<Obj>(
        ctx,
        'POST',
        '/v1/payment_intents',
        {
          amount: invoice.total,
          currency: invoice.currency.toLowerCase(),
          customer: method.gatewayCustomerId,
          payment_method: method.gatewayMethodId,
          payment_method_types: [method.type === 'ideal' ? 'sepa_debit' : method.type],
          off_session: true,
          confirm: true,
          description: invoiceLabel(invoice),
          metadata: { invoice_id: invoice.id, client_id: invoice.client.id, autopay: 'true' },
          statement_descriptor_suffix: ctx.config.statementDescriptor,
        },
        { idempotencyKey: `provisia:autopay:${invoice.id}:${method.id}:${day}` },
      );
      const status = str(pi.status);
      if (status === 'succeeded') {
        return {
          txnId: String(pi.id),
          status: 'succeeded',
          fee: await fetchFee(ctx, str(pi.latest_charge)),
        };
      }
      if (status === 'processing') return { txnId: String(pi.id), status: 'pending' };
      const err = obj(pi.last_payment_error);
      return {
        txnId: String(pi.id),
        status: 'failed',
        reason: str(err.message) ?? `payment intent status ${status}`,
      };
    } catch (err) {
      if (err instanceof StripeApiError && err.status === 402) {
        const pi = obj(obj(err.body?.error).payment_intent);
        return {
          txnId: str(pi.id) ?? `failed:${invoice.id}:${day}`,
          status: 'failed',
          reason: err.message,
        };
      }
      throw err;
    }
  },

  async removeSavedMethod(ctx: Ctx, method: PaymentMethodDTO) {
    try {
      await stripeRequest(ctx, 'POST', `/v1/payment_methods/${method.gatewayMethodId}/detach`);
    } catch (err) {
      // Already detached / unknown: nothing left to do at Stripe.
      if (err instanceof StripeApiError && err.status === 404) return;
      throw err;
    }
  },
});

export default stripe;

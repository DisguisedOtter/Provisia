import {
  defineGateway,
  type GatewayContext,
  type Money,
  type PaymentStatusResult,
  type RawRequest,
  type RefundResult,
  type ReturnResult,
  type TransactionDTO,
  type WebhookResult,
} from '@provisia/module-sdk';
import { parseMoney, toDecimalString } from '@provisia/shared';
import { type PaypalConfig, paypalConfigSchema } from './config.js';
import { getAccessToken, PaypalApiError, paypalRequest } from './http.js';

export { type PaypalConfig, paypalBaseUrl, paypalConfigSchema } from './config.js';
export { PaypalApiError, resetTokenCache } from './http.js';

type Ctx = GatewayContext<PaypalConfig>;
type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

export class PaypalWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaypalWebhookError';
  }
}

function amountOf(a: Obj, fallbackCurrency = 'EUR'): Money {
  const currency = str(a.currency_code) ?? fallbackCurrency;
  return parseMoney(str(a.value) ?? '0', currency);
}

function captureToResult(capture: Obj, eventId?: string): WebhookResult {
  const invoiceId = str(capture.custom_id);
  const status = str(capture.status);
  const txnId = String(capture.id);
  if (!invoiceId) return { kind: 'ignored', eventId, reason: 'capture without custom_id' };
  if (status === 'COMPLETED') {
    const breakdown = obj(capture.seller_receivable_breakdown);
    const fee = breakdown.paypal_fee ? amountOf(obj(breakdown.paypal_fee)) : undefined;
    return {
      kind: 'payment',
      eventId,
      txnId,
      invoiceId,
      amount: amountOf(obj(capture.amount)),
      fee,
      raw: { status, finalCapture: capture.final_capture ?? null },
    };
  }
  if (status === 'DECLINED' || status === 'DENIED' || status === 'FAILED') {
    return {
      kind: 'failed',
      eventId,
      txnId,
      invoiceId,
      reason: str(obj(capture.status_details).reason) ?? `capture ${status}`,
    };
  }
  // PENDING (e.g. eCheck / manual review): wait for PAYMENT.CAPTURE.COMPLETED.
  return { kind: 'ignored', eventId, reason: `capture status ${status}` };
}

/** First capture of an order, or undefined when nothing was captured yet. */
function firstCapture(order: Obj): Obj | undefined {
  const unit = arr(order.purchase_units)[0];
  return arr(obj(unit?.payments).captures)[0];
}

async function captureOrder(ctx: Ctx, orderId: string): Promise<Obj> {
  try {
    return await paypalRequest<Obj>(
      ctx,
      'POST',
      `/v2/checkout/orders/${orderId}/capture`,
      {},
      { requestId: `provisia:capture:${orderId}` },
    );
  } catch (err) {
    if (err instanceof PaypalApiError && err.issue === 'ORDER_ALREADY_CAPTURED') {
      return paypalRequest<Obj>(ctx, 'GET', `/v2/checkout/orders/${orderId}`);
    }
    throw err;
  }
}

function orderToResult(order: Obj, eventId?: string): WebhookResult {
  const capture = firstCapture(order);
  if (capture) {
    const unit = arr(order.purchase_units)[0];
    return captureToResult({ custom_id: unit?.custom_id, ...capture }, eventId);
  }
  return { kind: 'ignored', eventId, reason: `order status ${String(order.status)}` };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function portalUrl(ctx: Ctx, invoiceId: string | undefined, state: string): string {
  const base = ctx.webUrl.replace(/\/$/, '');
  return invoiceId
    ? `${base}/portal/invoices/${invoiceId}?payment=${state}`
    : `${base}/portal/invoices`;
}

const paypal = defineGateway({
  id: 'paypal',
  name: 'PayPal',
  version: '1.0.0',
  configSchema: paypalConfigSchema,
  capabilities: { refunds: true, savedMethods: false, recurring: false },

  async createPayment(ctx, invoice) {
    const hour = Math.floor(Date.now() / 3_600_000);
    const label = invoice.number
      ? `Invoice ${invoice.number}`
      : `Invoice ${invoice.id.slice(0, 8)}`;
    const returnUrl = new URL('/api/v1/public/payments/paypal/return', `${ctx.appUrl}/`);
    returnUrl.searchParams.set('invoice', invoice.id);
    const order = await paypalRequest<Obj>(
      ctx,
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'default',
            custom_id: invoice.id,
            description: label.slice(0, 127),
            amount: {
              currency_code: invoice.currency,
              value: toDecimalString({ amount: invoice.total, currency: invoice.currency }),
            },
          },
        ],
        payment_source: {
          paypal: {
            email_address: invoice.client.email,
            experience_context: {
              brand_name: ctx.config.brandName,
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              return_url: returnUrl.toString(),
              cancel_url: portalUrl(ctx, invoice.id, 'cancelled'),
            },
          },
        },
      },
      { requestId: `provisia:order:${invoice.id}:${invoice.total}:${hour}` },
    );
    const links = arr(order.links);
    const approve =
      links.find((l) => l.rel === 'payer-action') ?? links.find((l) => l.rel === 'approve');
    return { redirectUrl: str(approve?.href), txnId: String(order.id) };
  },

  async handleWebhook(ctx, req: RawRequest): Promise<WebhookResult> {
    const h = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const transmissionId = h('paypal-transmission-id');
    const transmissionSig = h('paypal-transmission-sig');
    const transmissionTime = h('paypal-transmission-time');
    const certUrl = h('paypal-cert-url');
    const authAlgo = h('paypal-auth-algo');
    if (!transmissionId || !transmissionSig || !transmissionTime || !certUrl || !authAlgo) {
      throw new PaypalWebhookError('missing PayPal transmission headers');
    }
    // The event must be embedded byte-for-byte; re-serialising the parsed JSON can break verification.
    const rawBody = `{"auth_algo":${JSON.stringify(authAlgo)},"cert_url":${JSON.stringify(certUrl)},"transmission_id":${JSON.stringify(transmissionId)},"transmission_sig":${JSON.stringify(transmissionSig)},"transmission_time":${JSON.stringify(transmissionTime)},"webhook_id":${JSON.stringify(ctx.config.webhookId)},"webhook_event":${req.rawBody.toString('utf8')}}`;
    const verification = await paypalRequest<Obj>(
      ctx,
      'POST',
      '/v1/notifications/verify-webhook-signature',
      undefined,
      { rawBody },
    );
    if (verification.verification_status !== 'SUCCESS') {
      throw new PaypalWebhookError('PayPal webhook signature verification failed');
    }

    const event = JSON.parse(req.rawBody.toString('utf8')) as Obj;
    const eventId = str(event.id);
    const type = str(event.event_type) ?? '';
    const resource = obj(event.resource);

    switch (type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        const order = await captureOrder(ctx, String(resource.id));
        return orderToResult(order, eventId);
      }
      case 'PAYMENT.CAPTURE.COMPLETED':
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED':
        return captureToResult(resource, eventId);
      case 'PAYMENT.CAPTURE.REFUNDED': {
        const up = arr(resource.links).find((l) => l.rel === 'up');
        const captureId = str(up?.href)?.split('/').pop();
        if (!captureId) return { kind: 'ignored', eventId, reason: 'refund without capture link' };
        return {
          kind: 'refund',
          eventId,
          txnId: String(resource.id),
          originalTxnId: captureId,
          amount: amountOf(obj(resource.amount)),
          raw: { status: resource.status ?? null },
        };
      }
      default:
        return { kind: 'ignored', eventId, reason: `unhandled event ${type}` };
    }
  },

  async handleReturn(ctx: Ctx, req: RawRequest): Promise<ReturnResult> {
    const q = (k: string) => {
      const v = req.query[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const orderId = q('token');
    const rawHint = q('invoice');
    const invoiceHint = rawHint && UUID_RE.test(rawHint) ? rawHint : undefined;
    if (!orderId) return { redirectUrl: portalUrl(ctx, invoiceHint, 'failed') };
    const order = await captureOrder(ctx, orderId);
    const result = orderToResult(order);
    const invoiceId =
      result.kind === 'payment' || result.kind === 'failed' ? result.invoiceId : invoiceHint;
    const state =
      result.kind === 'payment' ? 'success' : result.kind === 'failed' ? 'failed' : 'pending';
    return { redirectUrl: portalUrl(ctx, invoiceId ?? invoiceHint, state), result };
  },

  async refund(ctx: Ctx, txn: TransactionDTO, amount: Money): Promise<RefundResult> {
    const refund = await paypalRequest<Obj>(
      ctx,
      'POST',
      `/v2/payments/captures/${txn.gatewayTxnId}/refund`,
      {
        amount: { currency_code: amount.currency, value: toDecimalString(amount) },
        invoice_id: txn.invoiceId ?? undefined,
      },
      { requestId: `provisia:refund:${txn.id}:${amount.amount}` },
    );
    return {
      refundTxnId: String(refund.id),
      amount: refund.amount ? amountOf(obj(refund.amount), amount.currency) : amount,
      status: refund.status === 'COMPLETED' ? 'completed' : 'pending',
    };
  },

  async testCredentials(ctx: Ctx) {
    try {
      await getAccessToken(ctx);
      return { ok: true, message: `Authenticated against PayPal ${ctx.config.mode}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async getPaymentStatus(ctx: Ctx, orderId: string): Promise<PaymentStatusResult> {
    let order: Obj;
    try {
      order = await paypalRequest<Obj>(ctx, 'GET', `/v2/checkout/orders/${orderId}`);
    } catch (err) {
      if (err instanceof PaypalApiError && err.status === 404) {
        return { status: 'expired', reason: 'order no longer exists' };
      }
      throw err;
    }
    if (order.status === 'APPROVED') order = await captureOrder(ctx, orderId);
    const result = orderToResult(order);
    if (result.kind === 'payment') {
      return {
        status: 'succeeded',
        txnId: result.txnId,
        invoiceId: result.invoiceId,
        amount: result.amount,
        fee: result.fee,
      };
    }
    if (result.kind === 'failed')
      return {
        status: 'failed',
        txnId: result.txnId,
        invoiceId: result.invoiceId,
        reason: result.reason,
      };
    if (order.status === 'VOIDED') return { status: 'expired', reason: 'order voided' };
    return { status: 'pending' };
  },
});

export default paypal;

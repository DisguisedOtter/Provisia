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
import { parseMoney, toDecimalString } from '@provisia/shared';
import { type MollieConfig, mollieConfigSchema } from './config.js';
import { MollieApiError, mollieRequest } from './http.js';

export { type MollieConfig, mollieConfigSchema, mollieMethodSchema } from './config.js';
export { MollieApiError } from './http.js';

type Ctx = GatewayContext<MollieConfig>;
type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

export class MollieWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MollieWebhookError';
  }
}

function amountOf(a: Obj | undefined, fallbackCurrency = 'EUR'): Money {
  return parseMoney(str(a?.value) ?? '0', str(a?.currency) ?? fallbackCurrency);
}

function mollieAmount(m: Money): { currency: string; value: string } {
  return { currency: m.currency, value: toDecimalString(m) };
}

function webhookUrl(ctx: Ctx): string {
  return new URL('/api/v1/public/webhooks/mollie', `${ctx.appUrl}/`).toString();
}

function portalUrl(ctx: Ctx, path: string): string {
  return `${ctx.webUrl.replace(/\/$/, '')}${path}`;
}

function invoiceLabel(invoice: InvoiceDTO): string {
  return invoice.number ? `Invoice ${invoice.number}` : `Invoice ${invoice.id.slice(0, 8)}`;
}

function dueDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Parses the `id=tr_xxx` form body (or JSON) Mollie posts. */
export function parseWebhookId(req: RawRequest): string {
  const fromBody = obj(req.body).id;
  if (typeof fromBody === 'string') return fromBody;
  const text = req.rawBody.toString('utf8').trim();
  if (text.startsWith('{')) {
    try {
      const id = (JSON.parse(text) as Obj).id;
      if (typeof id === 'string') return id;
    } catch {
      // fall through
    }
  }
  const id = new URLSearchParams(text).get('id');
  if (!id) throw new MollieWebhookError('Mollie webhook without id');
  return id;
}

function mandateToMethod(mandate: Obj, customerId: string): SavedMethodInput {
  const method = str(mandate.method) ?? 'directdebit';
  const d = obj(mandate.details);
  let label = method;
  if (method === 'directdebit') {
    label =
      `SEPA ${str(d.consumerAccount)?.replace(/^(.{4}).*(.{4})$/, '$1 •••• $2') ?? ''}`.trim();
  } else if (method === 'creditcard') {
    label = `${str(d.cardLabel) ?? 'Card'} •••• ${str(d.cardNumber)?.slice(-4) ?? '????'}`;
  } else if (method === 'paypal') {
    label = `PayPal ${str(d.consumerAccount) ?? ''}`.trim();
  }
  return {
    type: method,
    gatewayCustomerId: customerId,
    gatewayMethodId: String(mandate.id),
    label,
    expiresAt: str(d.cardExpiryDate)?.slice(0, 7) ?? null,
    details: {
      ...d,
      mandateStatus: mandate.status ?? null,
      signatureDate: mandate.signatureDate ?? null,
    },
  };
}

function paymentToResult(payment: Obj): WebhookResult {
  const id = String(payment.id);
  const status = str(payment.status) ?? 'open';
  const eventId = `${id}:${status}`;
  const meta = obj(payment.metadata);
  const invoiceId = str(meta.invoiceId);
  if (status === 'paid') {
    if (!invoiceId)
      return { kind: 'ignored', eventId, reason: 'paid payment without invoiceId metadata' };
    const settlement = payment.settlementAmount
      ? amountOf(obj(payment.settlementAmount))
      : undefined;
    const amount = amountOf(obj(payment.amount));
    const fee =
      settlement && settlement.currency === amount.currency && settlement.amount < amount.amount
        ? { amount: amount.amount - settlement.amount, currency: amount.currency }
        : undefined;
    return {
      kind: 'payment',
      eventId,
      txnId: id,
      invoiceId,
      amount,
      fee,
      raw: {
        method: payment.method ?? null,
        sequenceType: payment.sequenceType ?? null,
        mandateId: payment.mandateId ?? null,
      },
    };
  }
  if (status === 'failed' || status === 'canceled' || status === 'expired') {
    return {
      kind: 'failed',
      eventId,
      txnId: id,
      invoiceId,
      reason: str(obj(payment.details).failureReason) ?? `payment ${status}`,
      raw: { method: payment.method ?? null },
    };
  }
  return { kind: 'ignored', eventId, reason: `payment status ${status}` };
}

const mollie = defineGateway({
  id: 'mollie',
  name: 'Mollie',
  version: '1.0.0',
  configSchema: mollieConfigSchema,
  capabilities: { refunds: true, savedMethods: true, recurring: true },

  async createPayment(ctx, invoice) {
    const body: Obj = {
      amount: mollieAmount({ amount: invoice.total, currency: invoice.currency }),
      description: invoiceLabel(invoice),
      redirectUrl: portalUrl(ctx, `/portal/invoices/${invoice.id}?payment=return`),
      cancelUrl: portalUrl(ctx, `/portal/invoices/${invoice.id}?payment=cancelled`),
      webhookUrl: webhookUrl(ctx),
      metadata: { invoiceId: invoice.id, clientId: invoice.client.id },
      locale: ctx.config.locale,
      dueDate: ctx.config.methods.includes('banktransfer')
        ? dueDate(ctx.config.bankTransferDueDays)
        : undefined,
      billingEmail: invoice.client.email,
    };
    if (ctx.config.methods.length === 1) body.method = ctx.config.methods[0];
    else if (ctx.config.methods.length > 1) body.method = ctx.config.methods;
    const payment = await mollieRequest<Obj>(ctx, 'POST', '/v2/payments', body, {
      idempotencyKey: `provisia:pay:${invoice.id}:${invoice.total}:${Math.floor(Date.now() / 3_600_000)}`,
    });
    const checkout = str(obj(obj(payment._links).checkout).href);
    return { redirectUrl: checkout, txnId: String(payment.id) };
  },

  /**
   * Mollie posts only `id=tr_...`; the status is fetched from the API, which is also what makes the webhook
   * trustworthy without a signature. Idempotency comes from `(gateway, txnId)` in the ledger plus the
   * `<id>:<status>` event id.
   */
  async handleWebhook(ctx, req: RawRequest): Promise<WebhookResult> {
    const id = parseWebhookId(req);
    if (!/^[a-z]{2,3}_[A-Za-z0-9]{1,64}$/.test(id)) {
      return { kind: 'ignored', reason: 'malformed id' };
    }
    if (id.startsWith('tr_')) {
      const payment = await mollieRequest<Obj>(
        ctx,
        'GET',
        `/v2/payments/${encodeURIComponent(id)}`,
      );
      const meta = obj(payment.metadata);
      if (payment.sequenceType === 'first' && meta.setup === true) {
        if (payment.status !== 'paid' || !payment.mandateId || !payment.customerId) {
          return {
            kind: 'ignored',
            eventId: `${id}:${String(payment.status)}`,
            reason: `first payment ${String(payment.status)}`,
          };
        }
        const customerId = String(payment.customerId);
        const mandate = await mollieRequest<Obj>(
          ctx,
          'GET',
          `/v2/customers/${customerId}/mandates/${String(payment.mandateId)}`,
        );
        if (mandate.status !== 'valid' && mandate.status !== 'pending') {
          return {
            kind: 'ignored',
            eventId: `${id}:mandate-${String(mandate.status)}`,
            reason: `mandate ${String(mandate.status)}`,
          };
        }
        const clientId = str(meta.clientId);
        if (!clientId)
          return {
            kind: 'ignored',
            eventId: `${id}:setup`,
            reason: 'first payment without clientId',
          };
        return {
          kind: 'setup_completed',
          eventId: `${id}:setup`,
          setupId: id,
          clientId,
          method: mandateToMethod(mandate, customerId),
          raw: { firstPaymentAmount: payment.amount ?? null },
        };
      }
      return paymentToResult(payment);
    }
    if (id.startsWith('re_')) {
      return {
        kind: 'ignored',
        eventId: `${id}:webhook`,
        reason: 'refund webhooks are reconciled from the payment',
      };
    }
    return { kind: 'ignored', eventId: `${id}:webhook`, reason: `unsupported resource ${id}` };
  },

  async refund(ctx: Ctx, txn: TransactionDTO, amount: Money): Promise<RefundResult> {
    const refund = await mollieRequest<Obj>(
      ctx,
      'POST',
      `/v2/payments/${txn.gatewayTxnId}/refunds`,
      {
        amount: mollieAmount(amount),
        description: `Refund ${txn.invoiceId ?? txn.id}`.slice(0, 140),
        metadata: { transactionId: txn.id },
      },
      { idempotencyKey: `provisia:refund:${txn.id}:${amount.amount}` },
    );
    return {
      refundTxnId: String(refund.id),
      amount: amountOf(obj(refund.amount), amount.currency),
      status: refund.status === 'refunded' ? 'completed' : 'pending',
    };
  },

  async testCredentials(ctx: Ctx) {
    try {
      const res = await mollieRequest<Obj>(ctx, 'GET', '/v2/methods');
      const count = typeof res.count === 'number' ? res.count : 0;
      return {
        ok: true,
        message: `Connected (${count} payment methods enabled, ${ctx.config.apiKey.startsWith('test_') ? 'test' : 'live'} mode)`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async getPaymentStatus(ctx: Ctx, txnId: string): Promise<PaymentStatusResult> {
    const payment = await mollieRequest<Obj>(ctx, 'GET', `/v2/payments/${txnId}`);
    const result = paymentToResult(payment);
    if (result.kind === 'payment')
      return {
        status: 'succeeded',
        txnId,
        invoiceId: result.invoiceId,
        amount: result.amount,
        fee: result.fee,
      };
    if (result.kind === 'failed') {
      return {
        status: payment.status === 'expired' ? 'expired' : 'failed',
        txnId,
        invoiceId: result.invoiceId,
        reason: result.reason,
      };
    }
    return { status: 'pending', txnId, invoiceId: str(obj(payment.metadata).invoiceId) };
  },

  /** Saving a method = customer + a `sequenceType: first` payment; the mandate arrives through the webhook. */
  async createSetup(ctx: Ctx, req: SetupRequest): Promise<SetupResult> {
    let customerId = req.gatewayCustomerId;
    if (!customerId) {
      const customer = await mollieRequest<Obj>(ctx, 'POST', '/v2/customers', {
        name: req.client.name,
        email: req.client.email,
        metadata: { clientId: req.client.id },
      });
      customerId = String(customer.id);
    }
    const joiner = req.returnUrl.includes('?') ? '&' : '?';
    const payment = await mollieRequest<Obj>(ctx, 'POST', '/v2/payments', {
      amount: mollieAmount({ amount: ctx.config.mandateAmount, currency: 'EUR' }),
      description: 'Payment method verification',
      customerId,
      sequenceType: 'first',
      redirectUrl: `${req.returnUrl}${joiner}setup=return`,
      webhookUrl: webhookUrl(ctx),
      metadata: { clientId: req.client.id, setup: true },
      locale: ctx.config.locale,
    });
    return {
      redirectUrl: str(obj(obj(payment._links).checkout).href),
      setupId: String(payment.id),
      gatewayCustomerId: customerId,
    };
  },

  async chargeSavedMethod(
    ctx: Ctx,
    invoice: InvoiceDTO,
    method: PaymentMethodDTO,
  ): Promise<ChargeResult> {
    const day = new Date().toISOString().slice(0, 10);
    const payment = await mollieRequest<Obj>(
      ctx,
      'POST',
      '/v2/payments',
      {
        amount: mollieAmount({ amount: invoice.total, currency: invoice.currency }),
        description: invoiceLabel(invoice),
        customerId: method.gatewayCustomerId,
        mandateId: method.gatewayMethodId,
        sequenceType: 'recurring',
        webhookUrl: webhookUrl(ctx),
        metadata: { invoiceId: invoice.id, clientId: invoice.client.id, autopay: true },
      },
      { idempotencyKey: `provisia:autopay:${invoice.id}:${method.id}:${day}` },
    );
    const status = str(payment.status);
    if (status === 'paid') return { txnId: String(payment.id), status: 'succeeded' };
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      return {
        txnId: String(payment.id),
        status: 'failed',
        reason: str(obj(payment.details).failureReason) ?? `payment ${status}`,
      };
    }
    // SEPA Direct Debit recurring payments stay `pending` for days; the webhook / reconciliation finishes them.
    return { txnId: String(payment.id), status: 'pending' };
  },

  async removeSavedMethod(ctx: Ctx, method: PaymentMethodDTO) {
    if (!method.gatewayCustomerId) return;
    try {
      await mollieRequest(
        ctx,
        'DELETE',
        `/v2/customers/${method.gatewayCustomerId}/mandates/${method.gatewayMethodId}`,
      );
    } catch (err) {
      if (err instanceof MollieApiError && err.status === 404) return;
      throw err;
    }
  },
});

export default mollie;

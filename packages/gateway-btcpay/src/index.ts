import {
  defineGateway,
  type GatewayContext,
  type Money,
  type PaymentStatusResult,
  type RawRequest,
  type RefundResult,
  type TransactionDTO,
  type WebhookResult,
} from '@provisia/module-sdk';
import { parseMoney, roundHalfUp, toDecimalString } from '@provisia/shared';
import { type BtcpayConfig, btcpayConfigSchema } from './config.js';
import { btcpayRequest } from './http.js';
import { verifyBtcpaySignature } from './signature.js';

export { type BtcpayConfig, btcpayConfigSchema } from './config.js';
export { BtcpayApiError } from './http.js';
export {
  BtcpaySignatureError,
  computeBtcpaySignature,
  verifyBtcpaySignature,
} from './signature.js';

type Ctx = GatewayContext<BtcpayConfig>;
type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

function storePath(ctx: Ctx, suffix: string): string {
  return `/api/v1/stores/${encodeURIComponent(ctx.config.storeId)}${suffix}`;
}

interface PaidSummary {
  /** Fiat value actually received (Σ totalPaid × rate per payment method), minor units. */
  paid: Money;
  /** Fiat amount the invoice asked for. */
  due: Money;
  paymentMethods: string[];
}

/** Computes how much fiat value was received, from the per-method `totalPaid` and `rate`. */
export function summarisePaid(invoice: Obj, methods: Obj[]): PaidSummary {
  const currency = (str(invoice.currency) ?? 'EUR').toUpperCase();
  const due = parseMoney(str(invoice.amount) ?? '0', currency);
  let paidFiat = 0;
  const ids: string[] = [];
  for (const pm of methods) {
    const totalPaid = Number(pm.totalPaid ?? 0);
    const rate = Number(pm.rate ?? 0);
    if (Number.isFinite(totalPaid) && Number.isFinite(rate)) paidFiat += totalPaid * rate;
    const id = str(pm.paymentMethodId) ?? str(pm.paymentMethod);
    if (id) ids.push(id);
  }
  return { paid: { amount: roundHalfUp(paidFiat * 100), currency }, due, paymentMethods: ids };
}

async function loadInvoice(ctx: Ctx, invoiceId: string): Promise<{ invoice: Obj; methods: Obj[] }> {
  const invoice = await btcpayRequest<Obj>(ctx, 'GET', storePath(ctx, `/invoices/${invoiceId}`));
  const methods = await btcpayRequest<Obj[]>(
    ctx,
    'GET',
    storePath(ctx, `/invoices/${invoiceId}/payment-methods`),
  );
  return { invoice, methods: arr(methods) };
}

function ourInvoiceId(invoice: Obj): string | undefined {
  const meta = obj(invoice.metadata);
  return str(meta.provisiaInvoiceId) ?? str(meta.orderId);
}

/** Maps a BTCPay invoice (with its payment methods) to a webhook result. */
export function invoiceToResult(invoice: Obj, methods: Obj[], eventId?: string): WebhookResult {
  const btcpayId = String(invoice.id);
  const invoiceId = ourInvoiceId(invoice);
  const status = str(invoice.status);
  const additional = str(invoice.additionalStatus);
  if (!invoiceId)
    return { kind: 'ignored', eventId, reason: 'invoice without Provisia invoice id in metadata' };
  const summary = summarisePaid(invoice, methods);
  const raw: Obj = {
    btcpayStatus: status,
    additionalStatus: additional ?? null,
    paidFiat: summary.paid.amount,
    due: summary.due.amount,
  };

  if (status === 'Settled') {
    // Settled = fully paid (possibly over). Report the fiat value received; the ledger credits overpayment.
    // When BTCPay reports PaidOver, trust the computed value; otherwise the invoice amount (rounding safety).
    const amount =
      additional === 'PaidOver' && summary.paid.amount > summary.due.amount
        ? summary.paid
        : summary.due;
    if (additional === 'PaidOver') raw.overpaid = amount.amount - summary.due.amount;
    return { kind: 'payment', eventId, txnId: btcpayId, invoiceId, amount, raw };
  }
  if (status === 'Expired') {
    if (summary.paid.amount > 0 || additional === 'PaidPartial') {
      // Partial payment: book what arrived; the invoice stays unpaid for the remainder.
      raw.partial = true;
      return {
        kind: 'payment',
        eventId,
        txnId: `${btcpayId}:partial`,
        invoiceId,
        amount: summary.paid,
        raw,
      };
    }
    return {
      kind: 'failed',
      eventId,
      txnId: btcpayId,
      invoiceId,
      reason: 'invoice expired unpaid',
      raw,
    };
  }
  if (status === 'Invalid') {
    return {
      kind: 'failed',
      eventId,
      txnId: btcpayId,
      invoiceId,
      reason: `invoice marked invalid (${additional ?? 'unknown'})`,
      raw,
    };
  }
  return { kind: 'ignored', eventId, reason: `invoice status ${status ?? 'unknown'}` };
}

const btcpay = defineGateway({
  id: 'btcpay',
  name: 'BTCPay Server',
  version: '1.0.0',
  configSchema: btcpayConfigSchema,
  capabilities: { refunds: true, savedMethods: false, recurring: false },

  async createPayment(ctx, invoice) {
    const label = invoice.number
      ? `Invoice ${invoice.number}`
      : `Invoice ${invoice.id.slice(0, 8)}`;
    const created = await btcpayRequest<Obj>(ctx, 'POST', storePath(ctx, '/invoices'), {
      amount: toDecimalString({ amount: invoice.total, currency: invoice.currency }),
      currency: invoice.currency,
      metadata: {
        orderId: invoice.id,
        provisiaInvoiceId: invoice.id,
        provisiaClientId: invoice.client.id,
        itemDesc: label,
        buyerEmail: invoice.client.email,
        buyerName: invoice.client.companyName ?? invoice.client.name,
      },
      checkout: {
        redirectURL: `${ctx.webUrl.replace(/\/$/, '')}/portal/invoices/${invoice.id}?payment=return`,
        redirectAutomatically: true,
        expirationMinutes: ctx.config.expirationMinutes,
        speedPolicy: ctx.config.speedPolicy,
      },
    });
    return { redirectUrl: str(created.checkoutLink), txnId: String(created.id) };
  },

  async handleWebhook(ctx, req: RawRequest): Promise<WebhookResult> {
    const header = req.headers['btcpay-sig'];
    verifyBtcpaySignature(
      req.rawBody,
      Array.isArray(header) ? header[0] : header,
      ctx.config.webhookSecret,
    );
    const event = JSON.parse(req.rawBody.toString('utf8')) as Obj;
    const eventId = str(event.originalDeliveryId) ?? str(event.deliveryId);
    const type = str(event.type) ?? '';
    const btcpayInvoiceId = str(event.invoiceId);
    if (event.storeId && event.storeId !== ctx.config.storeId) {
      return {
        kind: 'ignored',
        eventId,
        reason: `event for another store ${String(event.storeId)}`,
      };
    }
    if (!btcpayInvoiceId) return { kind: 'ignored', eventId, reason: 'event without invoiceId' };
    switch (type) {
      case 'InvoiceSettled':
      case 'InvoiceExpired':
      case 'InvoiceInvalid': {
        const { invoice, methods } = await loadInvoice(ctx, btcpayInvoiceId);
        if (event.manuallyMarked === true) {
          // Admin marked it in BTCPay; still booked, but flagged for the audit trail.
          const result = invoiceToResult(invoice, methods, eventId);
          if ('raw' in result && result.raw) result.raw.manuallyMarked = true;
          return result;
        }
        return invoiceToResult(invoice, methods, eventId);
      }
      default:
        // InvoiceCreated / InvoiceReceivedPayment / InvoiceProcessing / InvoicePaymentSettled: nothing final yet.
        return { kind: 'ignored', eventId, reason: `event ${type} carries no final state` };
    }
  },

  /** Refunds create a BTCPay pull payment the customer claims; the amount is fixed in the invoice currency. */
  async refund(ctx: Ctx, txn: TransactionDTO, amount: Money): Promise<RefundResult> {
    const btcpayInvoiceId = (txn.gatewayTxnId ?? '').replace(/:partial$/, '');
    const methods = arr(
      await btcpayRequest<Obj[]>(
        ctx,
        'GET',
        storePath(ctx, `/invoices/${btcpayInvoiceId}/payment-methods`),
      ),
    );
    const used = methods.find((m) => Number(m.totalPaid ?? 0) > 0) ?? methods[0];
    const paymentMethod = str(used?.paymentMethodId) ?? str(used?.paymentMethod) ?? 'BTC-CHAIN';
    const pull = await btcpayRequest<Obj>(
      ctx,
      'POST',
      storePath(ctx, `/invoices/${btcpayInvoiceId}/refund`),
      {
        name: `Refund ${txn.invoiceId ?? txn.id}`,
        paymentMethod,
        refundVariant: 'Custom',
        customAmount: toDecimalString(amount),
        customCurrency: amount.currency,
      },
    );
    return { refundTxnId: String(pull.id), amount, status: 'pending' };
  },

  async testCredentials(ctx: Ctx) {
    try {
      const store = await btcpayRequest<Obj>(ctx, 'GET', storePath(ctx, ''));
      return { ok: true, message: `Connected to store "${str(store.name) ?? ctx.config.storeId}"` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async getPaymentStatus(ctx: Ctx, txnId: string): Promise<PaymentStatusResult> {
    const { invoice, methods } = await loadInvoice(ctx, txnId.replace(/:partial$/, ''));
    const result = invoiceToResult(invoice, methods);
    if (result.kind === 'payment')
      return {
        status: 'succeeded',
        txnId: result.txnId,
        invoiceId: result.invoiceId,
        amount: result.amount,
      };
    if (result.kind === 'failed') {
      return {
        status: invoice.status === 'Expired' ? 'expired' : 'failed',
        txnId,
        invoiceId: result.invoiceId,
        reason: result.reason,
      };
    }
    return { status: 'pending', txnId, invoiceId: ourInvoiceId(invoice) };
  },
});

export default btcpay;

/**
 * Payment worker jobs (payments agent):
 *   billing:autoPay                 charge the saved method of auto-pay clients for invoices due today or earlier
 *   billing:reconcilePendingPayments poll gateways for payments that stayed pending > 1h
 *
 * The ledger (`markInvoicePaid`, intents, webhook results) lives in the API payments module and is imported
 * by relative path so the API and the worker share one implementation. Those files are plain `(db, …)`
 * functions without Fastify types.
 */

import {
  clientPaymentPreferences,
  clients,
  invoices,
  paymentIntents,
  paymentMethods,
  users,
} from '@provisia/db';
import btcpay from '@provisia/gateway-btcpay';
import mollie from '@provisia/gateway-mollie';
import paypal from '@provisia/gateway-paypal';
import stripe from '@provisia/gateway-stripe';
import { ModuleRegistry, type PaymentGateway } from '@provisia/module-sdk';
import type { EmailSendJob } from '@provisia/shared';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  type GatewayDeps,
  GatewayError,
  resolveGateway,
} from '../../../api/src/modules/payments/gateways.js';
import {
  applyWebhookResult,
  createPaymentIntentRow,
  invoiceOpenAmount,
  loadInvoiceDTO,
  markInvoicePaid,
  markPaymentFailed,
  paymentAudit,
  stalePendingIntents,
  toPaymentMethod,
  type WebhookDeps,
} from '../../../api/src/modules/payments/ledger.js';
import type { JobContext, JobHandler } from '../context.js';
import { enqueue, type JobData } from '../queues.js';

// ---------------------------------------------------------------------------------------------
// Module registry (worker side). Mirrors the gateways list in apps/api/src/modules/registry.ts.
// ---------------------------------------------------------------------------------------------
const gateways: PaymentGateway[] = [stripe, paypal, mollie, btcpay];
let registry: ModuleRegistry | undefined;
function modules(): ModuleRegistry {
  if (!registry) {
    registry = new ModuleRegistry();
    for (const g of gateways) registry.register('gateway', g);
  }
  return registry;
}

function deps(ctx: JobContext): WebhookDeps & GatewayDeps {
  return {
    db: ctx.db,
    modules: modules(),
    appKey: process.env.APP_KEY,
    appUrl: ctx.appUrl,
    webUrl: ctx.webUrl,
    logger: ctx.logger,
    emailSink: (job: EmailSendJob) => enqueue('email', 'send', job),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------------------------------------
 * Auto-pay
 * ---------------------------------------------------------------------------------------------- */

interface AutoPaySummary {
  considered: number;
  charged: number;
  pending: number;
  failed: number;
  skipped: number;
  errors: Array<{ invoiceId: string; error: string }>;
}

export const autoPay: JobHandler<JobData<'billing', 'autoPay'>> = async (ctx, data) => {
  const d = deps(ctx);
  const summary: AutoPaySummary = {
    considered: 0,
    charged: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Unpaid invoices due today or earlier whose client has auto-pay on with an active saved method.
  const rows = await ctx.db
    .select({
      invoiceId: invoices.id,
      clientId: invoices.clientId,
      dueDate: invoices.dueDate,
      method: paymentMethods,
    })
    .from(invoices)
    .innerJoin(clientPaymentPreferences, eq(clientPaymentPreferences.clientId, invoices.clientId))
    .innerJoin(paymentMethods, eq(paymentMethods.id, clientPaymentPreferences.paymentMethodId))
    .where(
      and(
        data.invoiceId
          ? eq(invoices.id, data.invoiceId)
          : inArray(invoices.status, ['unpaid', 'collections']),
        data.invoiceId ? undefined : lte(invoices.dueDate, today()),
        eq(clientPaymentPreferences.autoPay, true),
        eq(paymentMethods.clientId, invoices.clientId),
        eq(paymentMethods.status, 'active'),
      ),
    )
    .orderBy(invoices.dueDate)
    .limit(500);
  summary.considered = rows.length;

  for (const row of rows) {
    const { invoiceId } = row;
    try {
      // One attempt per invoice per day; never while a payment is still pending for it.
      const recent = await ctx.db
        .select({ status: paymentIntents.status, createdAt: paymentIntents.createdAt })
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.invoiceId, invoiceId),
            sql`${paymentIntents.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if (recent.some((r) => r.status === 'pending') || recent.some((r) => r.status === 'failed')) {
        summary.skipped++;
        continue;
      }
      const open = await invoiceOpenAmount(ctx.db, invoiceId);
      if (open <= 0) {
        summary.skipped++;
        continue;
      }
      const dto = await loadInvoiceDTO(ctx.db, invoiceId);
      if (!dto) {
        summary.skipped++;
        continue;
      }
      const method = toPaymentMethod(row.method);
      const { gateway, ctx: gctx } = await resolveGateway(d, method.gateway);
      if (!gateway.chargeSavedMethod)
        throw new GatewayError(
          'not_supported',
          `Gateway ${gateway.id} cannot charge saved methods`,
        );
      if (data.dryRun) {
        summary.skipped++;
        continue;
      }
      const charge = await gateway.chargeSavedMethod(gctx, { ...dto, total: open }, method);
      await createPaymentIntentRow(ctx.db, {
        invoiceId,
        clientId: row.clientId,
        gateway: gateway.id,
        gatewayTxnId: charge.txnId,
        amount: open,
        currency: dto.currency,
        source: 'autopay',
        paymentMethodId: method.id,
        status:
          charge.status === 'succeeded'
            ? 'pending'
            : charge.status === 'pending'
              ? 'pending'
              : 'failed',
        error: charge.status === 'failed' ? (charge.reason ?? 'declined') : null,
      });
      if (charge.status === 'succeeded') {
        await applyWebhookResult(
          d,
          gateway,
          {
            kind: 'payment',
            txnId: charge.txnId,
            invoiceId,
            amount: { amount: open, currency: dto.currency },
            fee: charge.fee,
            eventId: `autopay:${charge.txnId}`,
            raw: { autopay: true, methodId: method.id },
          },
          'reconcile',
        );
        summary.charged++;
      } else if (charge.status === 'pending') {
        summary.pending++;
      } else {
        summary.failed++;
        await markPaymentFailed(ctx.db, {
          gateway: gateway.id,
          txnId: charge.txnId,
          invoiceId,
          reason: charge.reason ?? 'declined',
        });
        await notifyAutoPayFailure(
          ctx,
          d,
          invoiceId,
          gateway.name,
          charge.reason ?? 'The payment was declined',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error({ err, invoiceId }, 'autopay: charge failed');
      summary.errors.push({ invoiceId, error: message });
      summary.failed++;
      await paymentAudit(ctx.db, {
        action: 'invoice.autopay_error',
        entityType: 'invoice',
        entityId: invoiceId,
        diff: { error: message },
      }).catch(() => {});
      await notifyAutoPayFailure(ctx, d, invoiceId, row.method.gateway, message).catch(() => {});
    }
  }
  return summary;
};

async function notifyAutoPayFailure(
  ctx: JobContext,
  d: WebhookDeps,
  invoiceId: string,
  gatewayName: string,
  reason: string,
): Promise<void> {
  const dto = await loadInvoiceDTO(ctx.db, invoiceId);
  if (!dto || !d.emailSink) return;
  const [user] = await ctx.db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      language: clients.language,
    })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, dto.clientId))
    .limit(1);
  const web = ctx.webUrl.replace(/\/$/, '');
  await d.emailSink({
    key: 'payment.failed',
    to: dto.client.email,
    toName: dto.client.name,
    toUserId: user?.id,
    locale: user?.language,
    data: {
      client: {
        firstName: user?.firstName || dto.client.name,
        lastName: user?.lastName ?? '',
        companyName: dto.client.companyName,
      },
      invoice: {
        id: dto.id,
        number: dto.number ?? '',
        total: { amount: dto.total, currency: dto.currency },
      },
      gateway: gatewayName,
      reason,
      payUrl: `${web}/portal/invoices/${dto.id}`,
    },
    related: { type: 'invoice', id: dto.id },
  });
}

/* ------------------------------------------------------------------------------------------------
 * Reconciliation of stuck pending payments
 * ---------------------------------------------------------------------------------------------- */

export const reconcilePendingPayments: JobHandler<
  JobData<'billing', 'reconcilePendingPayments'>
> = async (ctx, data) => {
  const d = deps(ctx);
  const olderThanMs = (data.olderThanMinutes ?? 60) * 60 * 1000;
  const stale = await stalePendingIntents(ctx.db, olderThanMs);
  const summary = {
    checked: stale.length,
    succeeded: 0,
    failed: 0,
    expired: 0,
    stillPending: 0,
    errors: 0,
  };

  for (const intent of stale) {
    try {
      const { gateway, ctx: gctx } = await resolveGateway(d, intent.gateway, {
        requireEnabled: false,
      });
      if (!gateway.getPaymentStatus) {
        summary.stillPending++;
        continue;
      }
      const status = await gateway.getPaymentStatus(gctx, intent.gatewayTxnId);
      switch (status.status) {
        case 'succeeded': {
          const amount = status.amount ?? {
            amount: Number(intent.amount),
            currency: intent.currency,
          };
          const txnId = status.txnId ?? intent.gatewayTxnId;
          const invoiceId = status.invoiceId ?? intent.invoiceId;
          await markInvoicePaid(ctx.db, invoiceId, {
            gateway: gateway.id,
            txnId,
            amount,
            fee: status.fee,
            raw: { reconciled: true, intentTxnId: intent.gatewayTxnId },
          });
          // The intent itself may carry a different id than the final txn (PayPal order vs capture).
          await ctx.db
            .update(paymentIntents)
            .set({ status: 'succeeded' })
            .where(eq(paymentIntents.id, intent.id));
          summary.succeeded++;
          break;
        }
        case 'failed':
          await ctx.db
            .update(paymentIntents)
            .set({ status: 'failed', error: status.reason ?? 'failed' })
            .where(eq(paymentIntents.id, intent.id));
          summary.failed++;
          break;
        case 'expired':
          await ctx.db
            .update(paymentIntents)
            .set({ status: 'expired', error: status.reason ?? 'expired' })
            .where(eq(paymentIntents.id, intent.id));
          summary.expired++;
          break;
        default:
          summary.stillPending++;
      }
    } catch (err) {
      summary.errors++;
      ctx.logger.warn(
        { err, intentId: intent.id, gateway: intent.gateway },
        'reconcile: could not poll gateway',
      );
    }
  }
  return summary;
};

export const paymentJobs = { autoPay, reconcilePendingPayments };

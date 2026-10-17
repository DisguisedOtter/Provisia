/**
 * Payment ledger glue. Everything that writes money state goes through here, from the API (webhooks,
 * returns, manual refunds) and the worker (auto-pay, reconciliation). No Fastify types.
 *
 * Invoice settlement itself is delegated to the billing agent's `recordPayment()` in `@provisia/core/db`
 * (idempotent per (gateway, gateway_txn_id), overpayment -> credit balance, service due dates), so there is
 * exactly one definition of "an invoice got paid". This module adds payment intents, saved methods,
 * refunds, the webhook event log and audit rows around it.
 */
import { BillingError, recordPayment as coreRecordPayment, openAmount } from '@provisia/core/db';
import {
  activityLog,
  clients,
  type Db,
  invoiceItems,
  invoices,
  paymentIntents,
  paymentMethods,
  paymentWebhookEvents,
  transactions,
  users,
} from '@provisia/db';
import type {
  InvoiceDTO,
  Money,
  PaymentGateway,
  RawRequest,
  SavedMethodInput,
  WebhookResult,
} from '@provisia/module-sdk';
import type { EmailSendJob, InvoiceItem, PaymentMethod } from '@provisia/shared';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { type GatewayDeps, GatewayError, resolveGateway } from './gateways.js';

export type Executor = Db;

const num = (v: number | string | null | undefined) =>
  typeof v === 'string' ? Number(v) : (v ?? 0);

/* ------------------------------------------------------------------------------------------------
 * Invoice DTO
 * ---------------------------------------------------------------------------------------------- */

export async function loadInvoiceDTO(db: Db, invoiceId: string): Promise<InvoiceDTO | null> {
  const [row] = await db
    .select({ invoice: invoices, client: clients, user: users })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(invoiceItems.sortOrder);
  const inv = row.invoice;
  return {
    id: inv.id,
    clientId: inv.clientId,
    number: inv.number,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    subtotal: num(inv.subtotal),
    taxTotal: num(inv.taxTotal),
    creditApplied: num(inv.creditApplied),
    total: num(inv.total),
    taxRate: inv.taxRate,
    reverseCharge: inv.reverseCharge,
    paidAt: inv.paidAt,
    pdfPath: inv.pdfPath,
    notes: inv.notes,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    items: items.map(
      (i): InvoiceItem => ({
        id: i.id,
        invoiceId: i.invoiceId,
        description: i.description,
        quantity: i.quantity,
        unitAmount: num(i.unitAmount),
        taxRate: i.taxRate,
        amount: num(i.amount),
        serviceId: i.serviceId,
        domainId: i.domainId,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        sortOrder: i.sortOrder,
        createdAt: i.createdAt,
      }),
    ),
    client: {
      id: row.client.id,
      email: row.user.email,
      name: `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.email,
      companyName: row.client.companyName,
      country: row.client.country,
    },
  };
}

/** Amount still open on an invoice (total minus payments plus refunds), via the billing core. */
export async function invoiceOpenAmount(db: Db, invoiceId: string): Promise<number> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw new GatewayError('not_found', 'Invoice not found', 404);
  return openAmount(db, inv);
}

/* ------------------------------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------------------------------- */

export async function paymentAudit(
  db: Db,
  input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    diff?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(activityLog).values({
    actorUserId: null,
    actorType: 'system',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    diff: input.diff ?? null,
    ip: null,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Payments
 * ---------------------------------------------------------------------------------------------- */

export interface PaymentTxn {
  gateway: string;
  txnId: string;
  amount: Money;
  fee?: Money;
  raw?: Record<string, unknown>;
  description?: string;
}

export interface MarkPaidResult {
  /** True when this (gateway, txnId) had been booked before; nothing changed. */
  duplicate: boolean;
  settled: boolean;
  overpayment: number;
  transactionId: string | null;
  invoiceId: string;
  clientId: string;
}

/**
 * Books a gateway payment against an invoice and marks it paid when settled, crediting any overpayment.
 * Defensive: validates currency, tolerates duplicates (idempotent on gateway + txn id), runs the ledger
 * write in one DB transaction (inside the billing core), then updates payment intents and audits.
 */
export async function markInvoicePaid(
  db: Db,
  invoiceId: string,
  txn: PaymentTxn,
): Promise<MarkPaidResult> {
  const [inv] = await db
    .select({ id: invoices.id, clientId: invoices.clientId, currency: invoices.currency })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new GatewayError('not_found', `Invoice ${invoiceId} not found`, 404);
  if (txn.amount.currency.toUpperCase() !== inv.currency.toUpperCase()) {
    throw new GatewayError(
      'currency_mismatch',
      `Payment in ${txn.amount.currency} for an invoice in ${inv.currency}`,
      422,
    );
  }
  if (!Number.isSafeInteger(txn.amount.amount) || txn.amount.amount <= 0) {
    throw new GatewayError(
      'invalid_amount',
      `Payment amount must be a positive integer, got ${txn.amount.amount}`,
      422,
    );
  }

  let result: MarkPaidResult;
  try {
    const r = await coreRecordPayment(db, invoiceId, {
      amount: txn.amount.amount,
      gateway: txn.gateway,
      gatewayTxnId: txn.txnId,
      fee: txn.fee?.amount ?? 0,
      description: txn.description ?? `${txn.gateway} payment ${txn.txnId}`,
      gatewayData: txn.raw ?? null,
    });
    result = {
      duplicate: false,
      settled: r.settled,
      overpayment: r.overpayment,
      transactionId: r.transaction.id,
      invoiceId,
      clientId: inv.clientId,
    };
  } catch (err) {
    if (err instanceof BillingError && err.code === 'duplicate_transaction') {
      const [existing] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.gateway, txn.gateway), eq(transactions.gatewayTxnId, txn.txnId)))
        .limit(1);
      const [state] = await db
        .select({ status: invoices.status })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);
      return {
        duplicate: true,
        settled: state?.status === 'paid',
        overpayment: 0,
        transactionId: existing?.id ?? null,
        invoiceId,
        clientId: inv.clientId,
      };
    }
    if (err instanceof BillingError)
      throw new GatewayError(err.code, err.message, err.status, err.details);
    throw err;
  }

  // Payment intents: the one that produced this txn, and (when settled) every other pending one for the invoice.
  await db
    .update(paymentIntents)
    .set({ status: 'succeeded', error: null })
    .where(
      and(eq(paymentIntents.gateway, txn.gateway), eq(paymentIntents.gatewayTxnId, txn.txnId)),
    );
  if (result.settled) {
    await db
      .update(paymentIntents)
      .set({ status: 'succeeded', error: 'settled by another payment' })
      .where(and(eq(paymentIntents.invoiceId, invoiceId), eq(paymentIntents.status, 'pending')));
  }
  await paymentAudit(db, {
    action: result.settled ? 'invoice.paid' : 'invoice.payment_received',
    entityType: 'invoice',
    entityId: invoiceId,
    diff: {
      gateway: txn.gateway,
      txnId: txn.txnId,
      amount: txn.amount.amount,
      currency: txn.amount.currency,
      overpayment: result.overpayment,
    },
  });
  return result;
}

/** Marks a gateway payment attempt as failed (payment intent + audit); never touches transactions. */
export async function markPaymentFailed(
  db: Db,
  input: { gateway: string; txnId: string; invoiceId?: string; reason: string },
): Promise<void> {
  await db
    .update(paymentIntents)
    .set({ status: 'failed', error: input.reason.slice(0, 1000) })
    .where(
      and(
        eq(paymentIntents.gateway, input.gateway),
        eq(paymentIntents.gatewayTxnId, input.txnId),
        eq(paymentIntents.status, 'pending'),
      ),
    );
  await paymentAudit(db, {
    action: 'invoice.payment_failed',
    entityType: 'invoice',
    entityId: input.invoiceId ?? null,
    diff: { gateway: input.gateway, txnId: input.txnId, reason: input.reason },
  });
}

/* ------------------------------------------------------------------------------------------------
 * Refunds
 * ---------------------------------------------------------------------------------------------- */

export interface RefundTxn {
  gateway: string;
  refundTxnId: string;
  originalTxnId: string;
  amount: Money;
  status?: 'completed' | 'pending';
  raw?: Record<string, unknown>;
  description?: string;
}

export interface RecordRefundResult {
  duplicate: boolean;
  transactionId: string | null;
  invoiceId: string | null;
  /** Invoice switched to `refunded` because refunds now cover every payment. */
  fullyRefunded: boolean;
}

/** Books a refund (idempotent on gateway + refund id) and flips the invoice to `refunded` when fully refunded. */
export async function recordRefund(db: Db, refund: RefundTxn): Promise<RecordRefundResult> {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.gateway, refund.gateway),
          eq(transactions.gatewayTxnId, refund.originalTxnId),
          eq(transactions.type, 'payment'),
        ),
      )
      .limit(1);
    if (!original) {
      throw new GatewayError(
        'original_transaction_not_found',
        `No ${refund.gateway} payment ${refund.originalTxnId} to refund`,
        404,
      );
    }
    if (refund.amount.currency.toUpperCase() !== original.currency.toUpperCase()) {
      throw new GatewayError('currency_mismatch', 'Refund currency differs from the payment', 422);
    }
    const [inserted] = await tx
      .insert(transactions)
      .values({
        clientId: original.clientId,
        invoiceId: original.invoiceId,
        gateway: refund.gateway,
        gatewayTxnId: refund.refundTxnId,
        type: 'refund',
        amount: Math.abs(refund.amount.amount),
        fee: 0,
        currency: original.currency,
        description: refund.description ?? `Refund of ${refund.originalTxnId}`,
        gatewayData: {
          ...(refund.raw ?? {}),
          originalTxnId: refund.originalTxnId,
          status: refund.status ?? 'completed',
        },
      })
      .onConflictDoNothing({ target: [transactions.gateway, transactions.gatewayTxnId] })
      .returning({ id: transactions.id });
    if (!inserted)
      return {
        duplicate: true,
        transactionId: null,
        invoiceId: original.invoiceId,
        fullyRefunded: false,
      };

    let fullyRefunded = false;
    if (original.invoiceId) {
      const rows = await tx
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .where(eq(transactions.invoiceId, original.invoiceId));
      let paid = 0;
      let refunded = 0;
      for (const r of rows) {
        if (r.type === 'payment' || r.type === 'credit') paid += num(r.amount);
        else if (r.type === 'refund') refunded += Math.abs(num(r.amount));
      }
      if (paid > 0 && refunded >= paid) {
        fullyRefunded = true;
        await tx
          .update(invoices)
          .set({ status: 'refunded' })
          .where(and(eq(invoices.id, original.invoiceId), eq(invoices.status, 'paid')));
      }
    }
    await tx.insert(activityLog).values({
      actorUserId: null,
      actorType: 'system',
      action: 'invoice.refund',
      entityType: 'invoice',
      entityId: original.invoiceId,
      diff: {
        gateway: refund.gateway,
        refundTxnId: refund.refundTxnId,
        originalTxnId: refund.originalTxnId,
        amount: refund.amount.amount,
        fullyRefunded,
      },
      ip: null,
    });
    return {
      duplicate: false,
      transactionId: inserted.id,
      invoiceId: original.invoiceId,
      fullyRefunded,
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Saved payment methods
 * ---------------------------------------------------------------------------------------------- */

export function toPaymentMethod(row: typeof paymentMethods.$inferSelect): PaymentMethod {
  return {
    id: row.id,
    clientId: row.clientId,
    gateway: row.gateway,
    type: row.type,
    gatewayCustomerId: row.gatewayCustomerId,
    gatewayMethodId: row.gatewayMethodId,
    label: row.label,
    expiresAt: row.expiresAt,
    isDefault: row.isDefault,
    status: row.status,
    details: row.details ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Idempotent on (gateway, gatewayMethodId). The first active method of a client becomes the default. */
export async function upsertSavedMethod(
  db: Db,
  clientId: string,
  gateway: string,
  method: SavedMethodInput,
): Promise<PaymentMethod> {
  return db.transaction(async (tx) => {
    const [hasDefault] = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.clientId, clientId),
          eq(paymentMethods.isDefault, true),
          eq(paymentMethods.status, 'active'),
        ),
      )
      .limit(1);
    const values = {
      clientId,
      gateway,
      type: method.type,
      gatewayCustomerId: method.gatewayCustomerId,
      gatewayMethodId: method.gatewayMethodId,
      label: method.label.slice(0, 200),
      expiresAt: method.expiresAt ?? null,
      status: 'active' as const,
      details: method.details ?? null,
      isDefault: !hasDefault,
    };
    const [row] = await tx
      .insert(paymentMethods)
      .values(values)
      .onConflictDoUpdate({
        target: [paymentMethods.gateway, paymentMethods.gatewayMethodId],
        set: {
          label: values.label,
          expiresAt: values.expiresAt,
          status: 'active',
          details: values.details,
          gatewayCustomerId: values.gatewayCustomerId,
        },
      })
      .returning();
    if (!row) throw new Error('payment method upsert failed');
    return toPaymentMethod(row);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Webhook pipeline
 * ---------------------------------------------------------------------------------------------- */

export interface WebhookDeps extends GatewayDeps {
  /** Optional sink for customer emails (`invoice.paid`); `(job) => enqueue('email', 'send', job)`. */
  emailSink?: (job: EmailSendJob) => Promise<unknown>;
}

export type WebhookOutcome =
  | {
      status: 'processed';
      kind: WebhookResult['kind'];
      result: WebhookResult;
      eventRowId: string | null;
    }
  | { status: 'ignored'; kind: 'ignored'; reason: string; eventRowId: string | null }
  | { status: 'duplicate'; kind: WebhookResult['kind']; eventRowId: string };

function eventIdOf(result: WebhookResult): string | null {
  if (result.eventId) return result.eventId;
  switch (result.kind) {
    case 'payment':
      return `payment:${result.txnId}`;
    case 'refund':
      return `refund:${result.txnId}`;
    case 'failed':
      return `failed:${result.txnId}`;
    case 'setup_completed':
      return `setup:${result.setupId}`;
    default:
      return null;
  }
}

function resultForLog(result: WebhookResult): Record<string, unknown> {
  // The result never carries secrets (gateways only return ids/amounts), so it can be stored as is.
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}

/**
 * Applies a gateway result to the ledger with the webhook event log as the idempotency barrier:
 * `(gateway, event_id)` is unique; a redelivered event that was processed or ignored is a no-op, a failed
 * one is retried. Invoice-level idempotency additionally comes from `(gateway, gateway_txn_id)`.
 */
export async function applyWebhookResult(
  deps: WebhookDeps,
  gateway: PaymentGateway,
  result: WebhookResult,
  source: 'webhook' | 'return' | 'reconcile' = 'webhook',
): Promise<WebhookOutcome> {
  const { db } = deps;
  const eventId = eventIdOf(result);
  if (!eventId)
    return {
      status: 'ignored',
      kind: 'ignored',
      reason: result.kind === 'ignored' ? result.reason : 'no event id',
      eventRowId: null,
    };

  const invoiceIdOf =
    result.kind === 'payment' || result.kind === 'failed' ? (result.invoiceId ?? null) : null;
  const txnIdOf =
    'txnId' in result ? result.txnId : result.kind === 'setup_completed' ? result.setupId : null;
  const [inserted] = await db
    .insert(paymentWebhookEvents)
    .values({
      gateway: gateway.id,
      eventId,
      eventType: `${source}:${result.kind}`,
      status: 'received',
      invoiceId: invoiceIdOf,
      txnId: txnIdOf,
      result: resultForLog(result),
    })
    .onConflictDoNothing({ target: [paymentWebhookEvents.gateway, paymentWebhookEvents.eventId] })
    .returning({ id: paymentWebhookEvents.id });
  let eventRowId: string;
  if (inserted) {
    eventRowId = inserted.id;
  } else {
    const [existing] = await db
      .select({ id: paymentWebhookEvents.id, status: paymentWebhookEvents.status })
      .from(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.gateway, gateway.id),
          eq(paymentWebhookEvents.eventId, eventId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('webhook event vanished');
    if (existing.status === 'processed' || existing.status === 'ignored') {
      return { status: 'duplicate', kind: result.kind, eventRowId: existing.id };
    }
    eventRowId = existing.id;
    await db
      .update(paymentWebhookEvents)
      .set({ status: 'received', error: null })
      .where(eq(paymentWebhookEvents.id, eventRowId));
  }

  try {
    let outcome: WebhookOutcome;
    switch (result.kind) {
      case 'payment': {
        const paid = await markInvoicePaid(db, result.invoiceId, {
          gateway: gateway.id,
          txnId: result.txnId,
          amount: result.amount,
          fee: result.fee,
          raw: { ...(result.raw ?? {}), eventId, source },
        });
        if (paid.settled && !paid.duplicate && deps.emailSink)
          await sendInvoicePaidEmail(deps, result.invoiceId, gateway.name);
        outcome = { status: 'processed', kind: 'payment', result, eventRowId };
        break;
      }
      case 'refund':
        await recordRefund(db, {
          gateway: gateway.id,
          refundTxnId: result.txnId,
          originalTxnId: result.originalTxnId,
          amount: result.amount,
          raw: { ...(result.raw ?? {}), eventId, source },
        });
        outcome = { status: 'processed', kind: 'refund', result, eventRowId };
        break;
      case 'failed':
        await markPaymentFailed(db, {
          gateway: gateway.id,
          txnId: result.txnId,
          invoiceId: result.invoiceId,
          reason: result.reason,
        });
        outcome = { status: 'processed', kind: 'failed', result, eventRowId };
        break;
      case 'setup_completed': {
        const [client] = await db
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, result.clientId))
          .limit(1);
        if (!client)
          throw new GatewayError(
            'not_found',
            `Client ${result.clientId} not found for setup ${result.setupId}`,
            404,
          );
        const method = await upsertSavedMethod(db, result.clientId, gateway.id, result.method);
        await paymentAudit(db, {
          action: 'payment_method.add',
          entityType: 'client',
          entityId: result.clientId,
          diff: { gateway: gateway.id, methodId: method.id, label: method.label },
        });
        outcome = { status: 'processed', kind: 'setup_completed', result, eventRowId };
        break;
      }
      default:
        outcome = { status: 'ignored', kind: 'ignored', reason: result.reason, eventRowId };
    }
    await db
      .update(paymentWebhookEvents)
      .set({
        status: outcome.status === 'ignored' ? 'ignored' : 'processed',
        processedAt: new Date(),
        error: null,
      })
      .where(eq(paymentWebhookEvents.id, eventRowId));
    return outcome;
  } catch (err) {
    await db
      .update(paymentWebhookEvents)
      .set({
        status: 'failed',
        processedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(paymentWebhookEvents.id, eventRowId));
    throw err;
  }
}

/** Full inbound webhook: resolve gateway (even when disabled), verify + parse via the module, apply. */
export async function processWebhook(
  deps: WebhookDeps,
  gatewayId: string,
  req: RawRequest,
): Promise<WebhookOutcome> {
  const { gateway, ctx } = await resolveGateway(deps, gatewayId, { requireEnabled: false });
  const result = await gateway.handleWebhook(ctx, req);
  return applyWebhookResult(deps, gateway, result, 'webhook');
}

async function sendInvoicePaidEmail(
  deps: WebhookDeps,
  invoiceId: string,
  gatewayName: string,
): Promise<void> {
  try {
    const dto = await loadInvoiceDTO(deps.db, invoiceId);
    if (!dto || !deps.emailSink) return;
    const [user] = await deps.db
      .select({ firstName: users.firstName, lastName: users.lastName, id: users.id })
      .from(users)
      .innerJoin(clients, eq(clients.userId, users.id))
      .where(eq(clients.id, dto.clientId))
      .limit(1);
    const web = deps.webUrl.replace(/\/$/, '');
    await deps.emailSink({
      key: 'invoice.paid',
      to: dto.client.email,
      toName: dto.client.name,
      toUserId: user?.id,
      data: {
        client: {
          firstName: user?.firstName || dto.client.name,
          lastName: user?.lastName ?? '',
          companyName: dto.client.companyName,
        },
        invoice: {
          id: dto.id,
          number: dto.number ?? '',
          issueDate: dto.issueDate ?? '',
          dueDate: dto.dueDate ?? '',
          total: { amount: dto.total, currency: dto.currency },
          status: 'paid',
        },
        invoiceUrl: `${web}/portal/invoices/${dto.id}`,
        paidAt: new Date().toISOString(),
        paymentMethod: gatewayName,
      },
      related: { type: 'invoice', id: dto.id },
    });
  } catch (err) {
    deps.logger.warn({ err, invoiceId }, 'payments: could not queue invoice.paid email');
  }
}

/* ------------------------------------------------------------------------------------------------
 * Payment intents
 * ---------------------------------------------------------------------------------------------- */

export async function createPaymentIntentRow(
  db: Db,
  input: {
    invoiceId: string;
    clientId: string;
    gateway: string;
    gatewayTxnId: string;
    amount: number;
    currency: string;
    source: 'checkout' | 'autopay';
    paymentMethodId?: string | null;
    status?: 'pending' | 'succeeded' | 'failed';
    error?: string | null;
  },
) {
  const [row] = await db
    .insert(paymentIntents)
    .values({
      ...input,
      status: input.status ?? 'pending',
      paymentMethodId: input.paymentMethodId ?? null,
      error: input.error ?? null,
    })
    .onConflictDoNothing({ target: [paymentIntents.gateway, paymentIntents.gatewayTxnId] })
    .returning();
  return row ?? null;
}

/** Pending intents older than `olderThanMs` (and younger than 60 days), oldest first. */
export async function stalePendingIntents(db: Db, olderThanMs: number, limit = 100) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const floor = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.status, 'pending'),
        lte(paymentIntents.createdAt, cutoff),
        gte(paymentIntents.createdAt, floor),
      ),
    )
    .orderBy(paymentIntents.createdAt)
    .limit(limit);
}

export async function latestIntentForInvoices(db: Db, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [];
  return db
    .select()
    .from(paymentIntents)
    .where(and(inArray(paymentIntents.invoiceId, invoiceIds), eq(paymentIntents.source, 'autopay')))
    .orderBy(desc(paymentIntents.createdAt));
}

import {
  clientPaymentPreferences,
  clients,
  type Db,
  invoices,
  paymentIntents,
  paymentMethods,
  paymentWebhookEvents,
  transactions,
  users,
} from '@provisia/db';
import type { ModuleLogger, ModuleRegistry, PaymentGateway } from '@provisia/module-sdk';
import {
  type AutoPaySettings,
  type ConfigureGateway,
  type Paginated,
  type PaginationQuery,
  type PaymentGatewayInfo,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentStart,
  type PaymentWebhookEvent,
  type PortalGateway,
  pageOffset,
  paginate,
  type RefundResponse,
  type SetupStart,
  type TestCredentialsResult,
} from '@provisia/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import {
  decryptGatewayConfig,
  describeGateway,
  enabledGateways,
  type GatewayDeps,
  GatewayError,
  listGatewayRows,
  publicConfig,
  resolveGateway,
  saveGatewayConfig,
  setGatewayEnabled,
} from './gateways.js';
import {
  createPaymentIntentRow,
  invoiceOpenAmount,
  loadInvoiceDTO,
  recordRefund,
  toPaymentMethod,
} from './ledger.js';

/** Turns ledger/gateway errors into the API error envelope. */
export function toAppError(err: unknown): unknown {
  if (err instanceof GatewayError)
    return new AppError(err.code, err.message, err.status, err.details);
  return err;
}

export interface Deps extends GatewayDeps {
  modules: ModuleRegistry;
  logger: ModuleLogger;
}

/* ------------------------------------------------------------------------------------------------
 * Admin: gateways
 * ---------------------------------------------------------------------------------------------- */

export async function listGateways(deps: Deps): Promise<PaymentGatewayInfo[]> {
  const rows = await listGatewayRows(deps.db);
  const byId = new Map(rows.map((r) => [r.gatewayId, r]));
  return deps.modules
    .list('gateway')
    .map((g) => describeGateway(g, byId.get(g.id), deps.appKey))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function requireModule(deps: Deps, gatewayId: string): PaymentGateway {
  const gateway = deps.modules.find('gateway', gatewayId);
  if (!gateway)
    throw new AppError(
      'gateway_not_installed',
      `Payment gateway "${gatewayId}" is not installed`,
      404,
    );
  return gateway;
}

export async function configureGateway(
  deps: Deps,
  gatewayId: string,
  input: ConfigureGateway,
): Promise<PaymentGatewayInfo> {
  const gateway = requireModule(deps, gatewayId);
  try {
    const row = await saveGatewayConfig(deps.db, gateway, input, deps.appKey);
    return describeGateway(gateway, row, deps.appKey);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function enableGateway(
  deps: Deps,
  gatewayId: string,
  enabled: boolean,
): Promise<PaymentGatewayInfo> {
  const gateway = requireModule(deps, gatewayId);
  try {
    const row = await setGatewayEnabled(deps.db, gateway, enabled, deps.appKey);
    return describeGateway(gateway, row, deps.appKey);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function testGateway(deps: Deps, gatewayId: string): Promise<TestCredentialsResult> {
  try {
    const { gateway, ctx } = await resolveGateway(deps, gatewayId, { requireEnabled: false });
    if (!gateway.testCredentials)
      return {
        ok: true,
        message: 'Gateway does not support a credential test; configuration is valid',
      };
    return await gateway.testCredentials(ctx);
  } catch (err) {
    if (err instanceof GatewayError) throw toAppError(err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Portal: paying an invoice
 * ---------------------------------------------------------------------------------------------- */

export async function portalGateways(deps: Deps): Promise<PortalGateway[]> {
  const list = await enabledGateways(deps);
  return list.map((g) => ({ id: g.id, name: g.name, capabilities: g.capabilities }));
}

/**
 * `POST /portal/invoices/:id/pay`. Runs `createPayment` inline (the customer is waiting for a redirect;
 * see the report for this documented deviation from "modules run in the worker").
 */
export async function startInvoicePayment(
  deps: Deps,
  clientId: string,
  invoiceId: string,
  gatewayId: string,
): Promise<PaymentStart> {
  const dto = await loadInvoiceDTO(deps.db, invoiceId);
  if (!dto || dto.clientId !== clientId) throw new AppError('not_found', 'Invoice not found', 404);
  if (dto.status !== 'unpaid' && dto.status !== 'collections') {
    throw new AppError('invoice_not_payable', `Invoice is ${dto.status}`, 409);
  }
  const open = await invoiceOpenAmount(deps.db, invoiceId);
  if (open <= 0) throw new AppError('invoice_not_payable', 'Invoice has no open amount', 409);
  let resolved: Awaited<ReturnType<typeof resolveGateway>>;
  try {
    resolved = await resolveGateway(deps, gatewayId);
  } catch (err) {
    throw toAppError(err);
  }
  const { gateway, ctx, config } = resolved;
  const payable = { ...dto, total: open };
  const start = await gateway.createPayment(ctx, payable);
  await createPaymentIntentRow(deps.db, {
    invoiceId,
    clientId,
    gateway: gateway.id,
    gatewayTxnId: start.txnId,
    amount: open,
    currency: dto.currency,
    source: 'checkout',
  });
  return {
    gateway: gateway.id,
    txnId: start.txnId,
    redirectUrl: start.redirectUrl,
    clientSecret: start.clientSecret,
    publicConfig: publicConfig(config),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Saved methods + auto-pay
 * ---------------------------------------------------------------------------------------------- */

export async function listClientMethods(db: Db, clientId: string): Promise<PaymentMethod[]> {
  const rows = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.clientId, clientId),
        inArray(paymentMethods.status, ['active', 'pending']),
      ),
    )
    .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt));
  return rows.map(toPaymentMethod);
}

export async function startSavedMethodSetup(
  deps: Deps,
  clientId: string,
  gatewayId: string,
): Promise<SetupStart> {
  let resolved: Awaited<ReturnType<typeof resolveGateway>>;
  try {
    resolved = await resolveGateway(deps, gatewayId);
  } catch (err) {
    throw toAppError(err);
  }
  const { gateway, ctx, config } = resolved;
  if (!gateway.capabilities.savedMethods || !gateway.createSetup) {
    throw new AppError('not_supported', `Gateway "${gatewayId}" cannot save payment methods`, 409);
  }
  const [row] = await deps.db
    .select({ client: clients, user: users })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Client not found', 404);
  const [existing] = await deps.db
    .select({ customer: paymentMethods.gatewayCustomerId })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.clientId, clientId), eq(paymentMethods.gateway, gatewayId)))
    .orderBy(desc(paymentMethods.createdAt))
    .limit(1);
  const result = await gateway.createSetup(ctx, {
    client: {
      id: clientId,
      email: row.user.email,
      name: `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.email,
    },
    gatewayCustomerId: existing?.customer ?? null,
    returnUrl: `${deps.webUrl.replace(/\/$/, '')}/portal/billing/payment-methods`,
  });
  return {
    gateway: gateway.id,
    setupId: result.setupId,
    redirectUrl: result.redirectUrl,
    clientSecret: result.clientSecret,
    publicConfig: publicConfig(config),
  };
}

/** Revokes at the gateway (best effort) and marks the row revoked. `clientId` scopes portal calls. */
export async function removeSavedMethod(
  deps: Deps,
  methodId: string,
  clientId?: string,
): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.id, methodId))
    .limit(1);
  if (!row || (clientId && row.clientId !== clientId))
    throw new AppError('not_found', 'Payment method not found', 404);
  if (row.status !== 'revoked') {
    try {
      const { gateway, ctx } = await resolveGateway(deps, row.gateway, { requireEnabled: false });
      await gateway.removeSavedMethod?.(ctx, toPaymentMethod(row));
    } catch (err) {
      deps.logger.warn(
        { err, methodId },
        'payments: gateway could not detach saved method; revoking locally',
      );
    }
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .update(paymentMethods)
      .set({ status: 'revoked', isDefault: false })
      .where(eq(paymentMethods.id, methodId));
    await tx
      .update(clientPaymentPreferences)
      .set({ paymentMethodId: null, autoPay: false })
      .where(
        and(
          eq(clientPaymentPreferences.clientId, row.clientId),
          eq(clientPaymentPreferences.paymentMethodId, methodId),
        ),
      );
    const [next] = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.clientId, row.clientId), eq(paymentMethods.status, 'active')))
      .orderBy(desc(paymentMethods.createdAt))
      .limit(1);
    if (row.isDefault && next)
      await tx
        .update(paymentMethods)
        .set({ isDefault: true })
        .where(eq(paymentMethods.id, next.id));
  });
}

export async function getAutoPay(db: Db, clientId: string): Promise<AutoPaySettings> {
  const [pref] = await db
    .select()
    .from(clientPaymentPreferences)
    .where(eq(clientPaymentPreferences.clientId, clientId))
    .limit(1);
  return { enabled: pref?.autoPay ?? false, paymentMethodId: pref?.paymentMethodId ?? null };
}

export async function setAutoPay(
  db: Db,
  clientId: string,
  input: AutoPaySettings,
): Promise<AutoPaySettings> {
  let methodId = input.paymentMethodId;
  if (input.enabled) {
    if (!methodId) {
      const [def] = await db
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.clientId, clientId), eq(paymentMethods.status, 'active')))
        .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt))
        .limit(1);
      methodId = def?.id ?? null;
    }
    if (!methodId)
      throw new AppError('no_payment_method', 'Add a payment method before enabling auto-pay', 409);
  }
  if (methodId) {
    const [m] = await db
      .select({
        id: paymentMethods.id,
        clientId: paymentMethods.clientId,
        status: paymentMethods.status,
      })
      .from(paymentMethods)
      .where(eq(paymentMethods.id, methodId))
      .limit(1);
    if (!m || m.clientId !== clientId || m.status !== 'active')
      throw new AppError('not_found', 'Payment method not found', 404);
    await db
      .update(paymentMethods)
      .set({ isDefault: false })
      .where(and(eq(paymentMethods.clientId, clientId), eq(paymentMethods.isDefault, true)));
    await db.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.id, methodId));
  }
  await db
    .insert(clientPaymentPreferences)
    .values({ clientId, autoPay: input.enabled, paymentMethodId: methodId })
    .onConflictDoUpdate({
      target: clientPaymentPreferences.clientId,
      set: { autoPay: input.enabled, paymentMethodId: methodId },
    });
  return { enabled: input.enabled, paymentMethodId: methodId };
}

/* ------------------------------------------------------------------------------------------------
 * Admin: refunds, events, intents
 * ---------------------------------------------------------------------------------------------- */

export async function refundTransaction(
  deps: Deps,
  transactionId: string,
  input: { amount?: number; reason?: string },
): Promise<RefundResponse> {
  const [txn] = await deps.db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!txn) throw new AppError('not_found', 'Transaction not found', 404);
  if (txn.type !== 'payment' || !txn.gatewayTxnId)
    throw new AppError('not_refundable', 'Only gateway payments can be refunded', 409);
  let resolved: Awaited<ReturnType<typeof resolveGateway>>;
  try {
    resolved = await resolveGateway(deps, txn.gateway, { requireEnabled: false });
  } catch (err) {
    throw toAppError(err);
  }
  const { gateway, ctx } = resolved;
  if (!gateway.capabilities.refunds || !gateway.refund)
    throw new AppError('not_supported', `Gateway "${gateway.id}" does not support refunds`, 409);

  const refunds = txn.invoiceId
    ? await deps.db
        .select({ amount: transactions.amount })
        .from(transactions)
        .where(
          and(
            eq(transactions.invoiceId, txn.invoiceId),
            eq(transactions.gateway, txn.gateway),
            eq(transactions.type, 'refund'),
          ),
        )
    : [];
  const refundedSoFar = refunds.reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const refundable = Number(txn.amount) - refundedSoFar;
  const amount = input.amount ?? refundable;
  if (amount <= 0 || amount > refundable) {
    throw new AppError(
      'invalid_amount',
      `Refundable amount is ${refundable} ${txn.currency}`,
      400,
      { refundable },
    );
  }
  const dto = {
    id: txn.id,
    clientId: txn.clientId,
    invoiceId: txn.invoiceId,
    gateway: txn.gateway,
    gatewayTxnId: txn.gatewayTxnId,
    type: txn.type,
    amount: Number(txn.amount),
    fee: Number(txn.fee),
    currency: txn.currency,
    description: txn.description,
    createdAt: txn.createdAt,
  };
  const result = await gateway.refund(ctx, dto, { amount, currency: txn.currency });
  try {
    await recordRefund(deps.db, {
      gateway: gateway.id,
      refundTxnId: result.refundTxnId,
      originalTxnId: txn.gatewayTxnId,
      amount: result.amount,
      status: result.status,
      description: input.reason ? `Refund: ${input.reason}` : undefined,
      raw: { source: 'admin' },
    });
  } catch (err) {
    throw toAppError(err);
  }
  return {
    refundTxnId: result.refundTxnId,
    amount: result.amount.amount,
    currency: result.amount.currency,
    status: result.status,
  };
}

export async function listWebhookEvents(
  db: Db,
  q: PaginationQuery & { gateway?: string; status?: PaymentWebhookEvent['status'] },
): Promise<Paginated<PaymentWebhookEvent>> {
  const where = and(
    q.gateway ? eq(paymentWebhookEvents.gateway, q.gateway) : undefined,
    q.status ? eq(paymentWebhookEvents.status, q.status) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(paymentWebhookEvents)
      .where(where)
      .orderBy(desc(paymentWebhookEvents.receivedAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(paymentWebhookEvents).where(where),
  ]);
  return paginate(
    rows.map((r) => ({
      id: r.id,
      gateway: r.gateway,
      eventId: r.eventId,
      eventType: r.eventType,
      status: r.status,
      invoiceId: r.invoiceId,
      txnId: r.txnId,
      error: r.error,
      receivedAt: r.receivedAt,
      processedAt: r.processedAt,
    })),
    Number(total?.n ?? 0),
    q,
  );
}

export async function listPaymentIntents(
  db: Db,
  q: PaginationQuery & { gateway?: string; status?: PaymentIntent['status']; invoiceId?: string },
): Promise<Paginated<PaymentIntent>> {
  const where = and(
    q.gateway ? eq(paymentIntents.gateway, q.gateway) : undefined,
    q.status ? eq(paymentIntents.status, q.status) : undefined,
    q.invoiceId ? eq(paymentIntents.invoiceId, q.invoiceId) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(paymentIntents)
      .where(where)
      .orderBy(desc(paymentIntents.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(paymentIntents).where(where),
  ]);
  return paginate(
    rows.map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId,
      clientId: r.clientId,
      gateway: r.gateway,
      gatewayTxnId: r.gatewayTxnId,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      source: r.source,
      error: r.error,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    Number(total?.n ?? 0),
    q,
  );
}

/** Admin visibility on an invoice's gateway state. */
export async function invoiceExists(db: Db, invoiceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return !!row;
}

export { decryptGatewayConfig };

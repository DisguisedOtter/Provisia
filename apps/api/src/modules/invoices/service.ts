import type { Executor, PaymentResult } from '@provisia/core/db';
import {
  BillingError,
  createLateFeeInvoice,
  recordPayment,
  resolveStorageRoot,
  storeCreditNotePdf,
  storeInvoicePdf,
} from '@provisia/core/db';
import { creditNotes, type Db, invoices, transactions } from '@provisia/db';
import type {
  CreditNote,
  Invoice,
  InvoiceListQuery,
  Transaction,
  TransactionListQuery,
} from '@provisia/shared';
import { type PaginationQuery, pageOffset, paginate } from '@provisia/shared';
import { enqueue } from '@provisia/worker/queues';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export { createLateFeeInvoice };

/** Turns engine errors into API error envelopes; rethrows anything else. */
export function mapBillingError(err: unknown): never {
  if (err instanceof BillingError)
    throw new AppError(err.code, err.message, err.status, err.details);
  throw err;
}

export async function withBilling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapBillingError(err);
  }
}

export async function listInvoices(db: Db, q: InvoiceListQuery, scope: { clientId?: string } = {}) {
  const clientId = scope.clientId ?? q.clientId;
  const where = and(
    clientId ? eq(invoices.clientId, clientId) : undefined,
    q.status ? eq(invoices.status, q.status) : undefined,
    // Portal users never see drafts.
    scope.clientId ? sql`${invoices.status} <> 'draft'` : undefined,
    q.number ? or(eq(invoices.number, q.number), like(invoices.number, `${q.number}%`)) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ total: sql<number>`count(*)::int` }).from(invoices).where(where),
  ]);
  return paginate(rows as unknown as Invoice[], count?.total ?? 0, q);
}

export async function listTransactions(
  db: Db,
  q: TransactionListQuery,
  scope: { clientId?: string } = {},
) {
  const clientId = scope.clientId ?? q.clientId;
  const where = and(
    clientId ? eq(transactions.clientId, clientId) : undefined,
    q.invoiceId ? eq(transactions.invoiceId, q.invoiceId) : undefined,
    q.gateway ? eq(transactions.gateway, q.gateway) : undefined,
    q.type ? eq(transactions.type, q.type) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ total: sql<number>`count(*)::int` }).from(transactions).where(where),
  ]);
  return paginate(rows as unknown as Transaction[], count?.total ?? 0, q);
}

export async function listCreditNotes(
  db: Db,
  q: PaginationQuery & { clientId?: string; invoiceId?: string },
  scope: { clientId?: string } = {},
) {
  const clientId = scope.clientId ?? q.clientId;
  const where = and(
    clientId ? eq(creditNotes.clientId, clientId) : undefined,
    q.invoiceId ? eq(creditNotes.invoiceId, q.invoiceId) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(creditNotes)
      .where(where)
      .orderBy(desc(creditNotes.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ total: sql<number>`count(*)::int` }).from(creditNotes).where(where),
  ]);
  return paginate(rows as unknown as CreditNote[], count?.total ?? 0, q);
}

/** Storage root for PDFs: `STORAGE_PATH` env, else `storage.localPath` setting, else `./storage`. */
export function storageRoot(): string {
  return resolveStorageRoot(process.env.STORAGE_PATH);
}

/** Renders (or re-renders) the PDF and returns its bytes; stored for issued documents. */
export async function invoicePdf(
  db: Executor,
  invoiceId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const stored = await storeInvoicePdf(db, invoiceId, { storageRoot: storageRoot() });
  return { buffer: stored.buffer, filename: stored.path.split('/').pop() ?? 'invoice.pdf' };
}

export async function creditNotePdf(
  db: Executor,
  creditNoteId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const stored = await storeCreditNotePdf(db, creditNoteId, { storageRoot: storageRoot() });
  return { buffer: stored.buffer, filename: stored.path.split('/').pop() ?? 'credit-note.pdf' };
}

/**
 * Side effects after a payment that settled an invoice: provision pending services, unsuspend suspended
 * ones, register/transfer pending domains and email the receipt. Payment gateways (payments agent) should
 * call `recordPayment` from `@provisia/core/db` and then this function.
 */
export async function applyPaymentSideEffects(
  db: Db,
  result: PaymentResult,
  opts: { email?: boolean } = {},
): Promise<void> {
  if (!result.settled) return;
  const invoiceId = result.invoice.id;
  for (const s of result.services) {
    if (s.wasPending)
      await enqueue(
        'provisioning',
        'create',
        { serviceId: s.id },
        { jobId: `provisioning-create-${s.id}` },
      );
    else if (s.wasSuspended)
      await enqueue(
        'provisioning',
        'unsuspend',
        { serviceId: s.id },
        { jobId: `provisioning-unsuspend-${s.id}-${invoiceId}` },
      );
  }
  if (result.domains.length > 0) {
    const { domains } = await import('@provisia/db');
    const { inArray } = await import('drizzle-orm');
    const rows = await db
      .select({ id: domains.id, status: domains.status })
      .from(domains)
      .where(
        inArray(
          domains.id,
          result.domains.map((d) => d.id),
        ),
      );
    for (const d of rows) {
      if (d.status === 'pending')
        await enqueue(
          'domains',
          'register',
          { domainId: d.id },
          { jobId: `domains-register-${d.id}` },
        );
      else if (d.status === 'pending_transfer')
        await enqueue(
          'domains',
          'transfer',
          { domainId: d.id },
          { jobId: `domains-transfer-${d.id}` },
        );
      else if (d.status === 'active') {
        const item = result.domains.find((x) => x.id === d.id);
        const years =
          item?.periodStart && item.periodEnd
            ? Math.max(
                1,
                Math.round(
                  (Date.parse(item.periodEnd) - Date.parse(item.periodStart)) /
                    (365.25 * 86_400_000),
                ),
              )
            : 1;
        await enqueue(
          'domains',
          'renew',
          { domainId: d.id, years },
          { jobId: `domains-renew-${d.id}-${invoiceId}` },
        );
      }
    }
  }
  if (opts.email !== false) {
    await enqueue(
      'billing',
      'sendInvoice',
      { invoiceId, templateKey: 'invoice.paid' },
      { jobId: `invoice-${invoiceId}-paid-${result.transaction.id}` },
    );
  }
}

/** Convenience used by the admin "mark paid" route and by gateways: book + side effects. */
export async function payInvoice(
  db: Db,
  invoiceId: string,
  input: Parameters<typeof recordPayment>[2],
): Promise<PaymentResult> {
  const result = await withBilling(() => recordPayment(db, invoiceId, input));
  await applyPaymentSideEffects(db, result);
  return result;
}

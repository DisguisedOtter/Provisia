import {
  clients,
  creditNoteItems,
  creditNotes,
  invoiceCounters,
  invoiceItems,
  invoices,
  services,
  transactions,
  users,
} from '@provisia/db';
import type { Settings } from '@provisia/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { allocatePayment, applyCredit, paidAmount } from '../credit.js';
import { addDays, type IsoDate, maxIsoDate, toIsoDate } from '../dates.js';
import { calculateInvoice } from '../invoice.js';
import { normalizePercent } from '../money.js';
import { type DocumentKind, nextDocumentNumber } from '../numbering.js';
import { lineTaxRate, type TaxDecision, taxNoteFor } from '../tax.js';
import { loadSettings } from './settings.js';
import { resolveClientTax } from './tax.js';
import { BillingError, type Executor, notFoundError, type Tx } from './types.js';

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceItemRow = typeof invoiceItems.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type CreditNoteRow = typeof creditNotes.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

export interface InvoiceWithItems extends InvoiceRow {
  items: InvoiceItemRow[];
}

export interface DraftItemInput {
  description: string;
  quantity?: number;
  unitAmount: number;
  /** Explicit rate (`"21.00"`); when omitted the client's tax decision decides (`taxable` = true). */
  taxRate?: string | null;
  taxable?: boolean;
  serviceId?: string | null;
  domainId?: string | null;
  periodStart?: IsoDate | null;
  periodEnd?: IsoDate | null;
  sortOrder?: number;
}

export interface CreateDraftInput {
  clientId: string;
  items: DraftItemInput[];
  dueDate?: IsoDate | null;
  notes?: string | null;
  parentInvoiceId?: string | null;
  now?: Date;
}

const OPEN_STATUSES = ['unpaid', 'collections'] as const;

async function inTx<T>(db: Executor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function getClient(db: Executor, clientId: string): Promise<ClientRow> {
  const [row] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!row) throw notFoundError('Client');
  return row;
}

export async function getInvoice(db: Executor, invoiceId: string): Promise<InvoiceWithItems> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw notFoundError('Invoice');
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.createdAt));
  return { ...inv, items };
}

export async function invoiceTransactions(
  db: Executor,
  invoiceId: string,
): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.invoiceId, invoiceId))
    .orderBy(asc(transactions.createdAt));
}

/** total - (payments + applied credit - refunds). Never negative. */
export async function openAmount(db: Executor, invoice: InvoiceRow): Promise<number> {
  const txns = await invoiceTransactions(db, invoice.id);
  return Math.max(0, invoice.total - paidAmount(txns));
}

/** Tax decision for the client of an invoice as of a date (issue date or today). */
export async function clientTaxDecision(
  db: Executor,
  client: ClientRow,
  settings: Settings,
  asOf: IsoDate,
): Promise<TaxDecision> {
  return resolveClientTax(db, client, settings, asOf);
}

function itemRates(items: DraftItemInput[], decision: TaxDecision) {
  return items.map((it, i) => ({
    description: it.description,
    quantity: it.quantity ?? 1,
    unitAmount: it.unitAmount,
    taxRate:
      it.taxRate != null ? normalizePercent(it.taxRate) : lineTaxRate(decision, it.taxable ?? true),
    serviceId: it.serviceId ?? null,
    domainId: it.domainId ?? null,
    periodStart: it.periodStart ?? null,
    periodEnd: it.periodEnd ?? null,
    sortOrder: it.sortOrder ?? i,
  }));
}

/** Creates a `draft` invoice with its lines; totals computed by the core calculator. */
export async function createDraftInvoice(
  db: Executor,
  input: CreateDraftInput,
): Promise<InvoiceWithItems> {
  if (input.items.length === 0)
    throw new BillingError('invoice_empty', 'An invoice needs at least one line', 400);
  const now = input.now ?? new Date();
  const today = toIsoDate(now);
  return inTx(db, async (tx) => {
    const client = await getClient(tx, input.clientId);
    const settings = await loadSettings(tx);
    const decision = await clientTaxDecision(tx, client, settings, today);
    const lines = itemRates(input.items, decision);
    const totals = calculateInvoice(lines, client.currency);
    const [inv] = await tx
      .insert(invoices)
      .values({
        clientId: client.id,
        status: 'draft',
        dueDate: input.dueDate ?? null,
        currency: client.currency,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        taxRate: totals.taxRate,
        taxSummary: totals.taxSummary,
        reverseCharge: decision.reverseCharge,
        notes: input.notes ?? null,
        parentInvoiceId: input.parentInvoiceId ?? null,
      })
      .returning();
    if (!inv) throw new Error('insert invoice failed');
    const rows = await tx
      .insert(invoiceItems)
      .values(
        totals.lines.map((l, i) => ({
          invoiceId: inv.id,
          description: l.description ?? '',
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          taxRate: l.taxRate,
          amount: l.amount,
          serviceId: lines[i]?.serviceId ?? null,
          domainId: lines[i]?.domainId ?? null,
          periodStart: lines[i]?.periodStart ?? null,
          periodEnd: lines[i]?.periodEnd ?? null,
          sortOrder: lines[i]?.sortOrder ?? i,
        })),
      )
      .returning();
    return { ...inv, items: rows };
  });
}

/** Recomputes subtotal/tax/total from the stored lines (draft edits). */
export async function recalculateInvoice(
  tx: Executor,
  invoiceId: string,
): Promise<InvoiceWithItems> {
  const inv = await getInvoice(tx, invoiceId);
  const totals = calculateInvoice(
    inv.items.map((i) => ({ quantity: i.quantity, unitAmount: i.unitAmount, taxRate: i.taxRate })),
    inv.currency,
  );
  const [updated] = await tx
    .update(invoices)
    .set({
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      taxRate: totals.taxRate,
      taxSummary: totals.taxSummary,
    })
    .where(eq(invoices.id, invoiceId))
    .returning();
  if (!updated) throw notFoundError('Invoice');
  return { ...updated, items: inv.items };
}

async function lockDraft(tx: Tx, invoiceId: string): Promise<InvoiceRow> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!inv) throw notFoundError('Invoice');
  if (inv.status !== 'draft')
    throw new BillingError('invoice_locked', 'Only draft invoices can be edited');
  return inv;
}

export async function updateDraftInvoice(
  db: Executor,
  invoiceId: string,
  patch: { dueDate?: IsoDate; notes?: string | null },
): Promise<InvoiceWithItems> {
  return inTx(db, async (tx) => {
    await lockDraft(tx, invoiceId);
    await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
    return getInvoice(tx, invoiceId);
  });
}

export async function addInvoiceItem(
  db: Executor,
  invoiceId: string,
  item: DraftItemInput,
): Promise<InvoiceWithItems> {
  return inTx(db, async (tx) => {
    const inv = await lockDraft(tx, invoiceId);
    const client = await getClient(tx, inv.clientId);
    const settings = await loadSettings(tx);
    const decision = await clientTaxDecision(tx, client, settings, toIsoDate(new Date()));
    const [line] = itemRates([item], decision);
    if (!line) throw new Error('unreachable');
    const [cnt] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));
    await tx.insert(invoiceItems).values({
      invoiceId,
      ...line,
      amount: line.quantity * line.unitAmount,
      sortOrder: item.sortOrder ?? cnt?.count ?? 0,
    });
    return recalculateInvoice(tx, invoiceId);
  });
}

export async function updateInvoiceItem(
  db: Executor,
  invoiceId: string,
  itemId: string,
  patch: Partial<DraftItemInput>,
): Promise<InvoiceWithItems> {
  return inTx(db, async (tx) => {
    await lockDraft(tx, invoiceId);
    const [existing] = await tx
      .select()
      .from(invoiceItems)
      .where(and(eq(invoiceItems.id, itemId), eq(invoiceItems.invoiceId, invoiceId)));
    if (!existing) throw notFoundError('Invoice item');
    const quantity = patch.quantity ?? existing.quantity;
    const unitAmount = patch.unitAmount ?? existing.unitAmount;
    await tx
      .update(invoiceItems)
      .set({
        description: patch.description ?? existing.description,
        quantity,
        unitAmount,
        amount: quantity * unitAmount,
        taxRate: patch.taxRate != null ? normalizePercent(patch.taxRate) : existing.taxRate,
        serviceId: patch.serviceId === undefined ? existing.serviceId : patch.serviceId,
        domainId: patch.domainId === undefined ? existing.domainId : patch.domainId,
        periodStart: patch.periodStart === undefined ? existing.periodStart : patch.periodStart,
        periodEnd: patch.periodEnd === undefined ? existing.periodEnd : patch.periodEnd,
        sortOrder: patch.sortOrder ?? existing.sortOrder,
      })
      .where(eq(invoiceItems.id, itemId));
    return recalculateInvoice(tx, invoiceId);
  });
}

export async function deleteInvoiceItem(
  db: Executor,
  invoiceId: string,
  itemId: string,
): Promise<InvoiceWithItems> {
  return inTx(db, async (tx) => {
    await lockDraft(tx, invoiceId);
    const deleted = await tx
      .delete(invoiceItems)
      .where(and(eq(invoiceItems.id, itemId), eq(invoiceItems.invoiceId, invoiceId)))
      .returning({ id: invoiceItems.id });
    if (deleted.length === 0) throw notFoundError('Invoice item');
    return recalculateInvoice(tx, invoiceId);
  });
}

/**
 * Takes the next gap-free number for (kind, year of issueDate). Must run inside the transaction that
 * persists the document: the counter row is locked with `SELECT ... FOR UPDATE` until commit.
 */
export async function takeNextNumber(
  tx: Tx,
  kind: DocumentKind,
  issueDate: IsoDate,
): Promise<string> {
  const year = Number(issueDate.slice(0, 4));
  await tx.insert(invoiceCounters).values({ kind, year, lastNumber: 0 }).onConflictDoNothing();
  const [counter] = await tx
    .select()
    .from(invoiceCounters)
    .where(and(eq(invoiceCounters.kind, kind), eq(invoiceCounters.year, year)))
    .for('update');
  if (!counter) throw new Error('counter row missing after upsert');
  const next = nextDocumentNumber(kind, issueDate, {
    year: counter.year,
    lastNumber: counter.lastNumber,
  });
  await tx
    .update(invoiceCounters)
    .set({ lastNumber: next.sequence })
    .where(and(eq(invoiceCounters.kind, kind), eq(invoiceCounters.year, year)));
  return next.number;
}

async function billingSnapshot(
  tx: Executor,
  client: ClientRow,
  settings: Settings,
  decision: TaxDecision,
) {
  const [user] = await tx
    .select({ email: users.email, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, client.userId));
  return {
    client: {
      id: client.id,
      name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
      email: user?.email ?? null,
      companyName: client.companyName,
      vatNumber: client.vatNumber,
      vatValidated: client.vatValidated,
      address1: client.address1,
      address2: client.address2,
      postalCode: client.postalCode,
      city: client.city,
      state: client.state,
      country: client.country,
      language: client.language,
    },
    company: {
      name: settings['company.name'],
      legalName: settings['company.legalName'],
      address: settings['company.address'],
      country: settings['company.country'],
      vatNumber: settings['company.vatNumber'],
      kvk: settings['company.kvk'],
      email: settings['company.email'],
      phone: settings['company.phone'],
      website: settings['company.website'],
      iban: settings['company.iban'],
      bic: settings['company.bic'],
    },
    tax: {
      kind: decision.kind,
      rate: decision.rate,
      reverseCharge: decision.reverseCharge,
      note: decision.note,
      noteText: taxNoteFor(decision, client.language),
    },
  };
}

export interface IssueResult {
  invoice: InvoiceWithItems;
  creditApplied: number;
  /** True when credit covered the whole amount (invoice is `paid` right away). */
  settled: boolean;
}

/**
 * draft → unpaid (or paid when credit covers it). Inside one transaction: lock invoice, re-evaluate the
 * client's tax position as of today (rates on explicitly-rated lines are kept, auto lines follow the
 * decision), take the number, apply credit, snapshot the billing details, lock the invoice.
 */
export async function issueInvoice(
  db: Executor,
  invoiceId: string,
  opts: { now?: Date } = {},
): Promise<IssueResult> {
  const now = opts.now ?? new Date();
  const today = toIsoDate(now);
  return inTx(db, async (tx) => {
    const inv = await lockDraft(tx, invoiceId);
    const settings = await loadSettings(tx);
    const [client] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, inv.clientId))
      .for('update');
    if (!client) throw notFoundError('Client');
    const items = await tx
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceItems.sortOrder));
    if (items.length === 0)
      throw new BillingError('invoice_empty', 'Cannot issue an invoice without lines', 400);

    const decision = await clientTaxDecision(tx, client, settings, today);
    const totals = calculateInvoice(
      items.map((i) => ({ quantity: i.quantity, unitAmount: i.unitAmount, taxRate: i.taxRate })),
      inv.currency,
    );
    const number = await takeNextNumber(tx, 'invoice', today);
    const dueDate = inv.dueDate
      ? maxIsoDate(inv.dueDate, today)
      : addDays(today, settings['billing.paymentTermDays']);

    let creditApplied = 0;
    if (
      settings['billing.autoApplyCredit'] !== false &&
      totals.total > 0 &&
      client.creditBalance > 0
    ) {
      const app = applyCredit(totals.total, client.creditBalance);
      creditApplied = app.applied;
      if (creditApplied > 0) {
        await tx
          .update(clients)
          .set({ creditBalance: app.remainingBalance })
          .where(eq(clients.id, client.id));
        await tx.insert(transactions).values({
          clientId: client.id,
          invoiceId,
          gateway: 'credit',
          type: 'credit',
          amount: creditApplied,
          currency: inv.currency,
          description: `Credit applied to invoice ${number}`,
        });
      }
    }
    const settled = totals.total - creditApplied <= 0;
    const [updated] = await tx
      .update(invoices)
      .set({
        number,
        status: settled ? 'paid' : 'unpaid',
        issueDate: today,
        dueDate,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        taxRate: totals.taxRate,
        taxSummary: totals.taxSummary,
        reverseCharge: decision.reverseCharge,
        creditApplied,
        paidAt: settled ? now : null,
        billingSnapshot: await billingSnapshot(tx, client, settings, decision),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (!updated) throw notFoundError('Invoice');
    if (settled) await advanceServicesForPaidInvoice(tx, invoiceId);
    return { invoice: { ...updated, items }, creditApplied, settled };
  });
}

export interface PaymentInput {
  amount: number;
  gateway?: string;
  gatewayTxnId?: string | null;
  fee?: number;
  description?: string | null;
  gatewayData?: Record<string, unknown> | null;
  now?: Date;
}

export interface PaymentResult {
  invoice: InvoiceWithItems;
  transaction: TransactionRow;
  settled: boolean;
  /** Part of the payment booked onto the credit balance. */
  overpayment: number;
  /** Services referenced by the invoice lines, for provisioning side effects (activate / unsuspend). */
  services: Array<{ id: string; status: string; wasPending: boolean; wasSuspended: boolean }>;
  /** Domains referenced by the invoice lines (register / renew is the domains agent's job). */
  domains: Array<{ id: string; periodStart: IsoDate | null; periodEnd: IsoDate | null }>;
}

/**
 * Books a payment. Idempotent per (gateway, gatewayTxnId): a repeat returns `duplicate_transaction`.
 * Settles the invoice when the open amount reaches zero; the excess goes to the credit balance.
 */
export async function recordPayment(
  db: Executor,
  invoiceId: string,
  input: PaymentInput,
): Promise<PaymentResult> {
  const now = input.now ?? new Date();
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new BillingError('invalid_amount', 'Payment amount must be a positive integer', 400);
  }
  return inTx(db, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw notFoundError('Invoice');
    if (!['unpaid', 'collections', 'paid'].includes(inv.status)) {
      throw new BillingError('invoice_not_payable', `Invoice is ${inv.status}`);
    }
    const gateway = input.gateway ?? 'manual';
    if (input.gatewayTxnId) {
      const [dup] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(eq(transactions.gateway, gateway), eq(transactions.gatewayTxnId, input.gatewayTxnId)),
        );
      if (dup)
        throw new BillingError(
          'duplicate_transaction',
          'This gateway transaction was already booked',
        );
    }
    const open = await openAmount(tx, inv);
    const alloc = allocatePayment(input.amount, open);
    const [txn] = await tx
      .insert(transactions)
      .values({
        clientId: inv.clientId,
        invoiceId,
        gateway,
        gatewayTxnId: input.gatewayTxnId ?? null,
        type: 'payment',
        amount: input.amount,
        fee: input.fee ?? 0,
        currency: inv.currency,
        description: input.description ?? null,
        gatewayData: input.gatewayData ?? null,
        createdAt: now,
      })
      .returning();
    if (!txn) throw new Error('insert transaction failed');
    if (alloc.overpayment > 0) {
      await tx
        .update(clients)
        .set({ creditBalance: sql`${clients.creditBalance} + ${alloc.overpayment}` })
        .where(eq(clients.id, inv.clientId));
    }
    const wasOpen = inv.status !== 'paid';
    if (alloc.settled && wasOpen) {
      await tx
        .update(invoices)
        .set({ status: 'paid', paidAt: now })
        .where(eq(invoices.id, invoiceId));
    }
    const full = await getInvoice(tx, invoiceId);
    const serviceIds = [
      ...new Set(full.items.map((i) => i.serviceId).filter((x): x is string => !!x)),
    ];
    const svcRows =
      serviceIds.length > 0
        ? await tx
            .select({ id: services.id, status: services.status })
            .from(services)
            .where(inArray(services.id, serviceIds))
        : [];
    const result: PaymentResult = {
      invoice: full,
      transaction: txn,
      settled: alloc.settled,
      overpayment: alloc.overpayment,
      services: svcRows.map((s) => ({
        id: s.id,
        status: s.status,
        wasPending: s.status === 'pending',
        wasSuspended: s.status === 'suspended',
      })),
      domains: full.items
        .filter((i) => i.domainId)
        .map((i) => ({
          id: i.domainId as string,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
        })),
    };
    if (alloc.settled && wasOpen) await advanceServicesForPaidInvoice(tx, invoiceId);
    return result;
  });
}

/** After a paid invoice: move each referenced service's next due date past the paid period. */
export async function advanceServicesForPaidInvoice(
  tx: Executor,
  invoiceId: string,
): Promise<void> {
  const items = await tx
    .select({ serviceId: invoiceItems.serviceId, periodEnd: invoiceItems.periodEnd })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));
  for (const it of items) {
    if (!it.serviceId || !it.periodEnd) continue;
    const next = addDays(it.periodEnd, 1);
    await tx
      .update(services)
      .set({
        nextDueDate: sql`greatest(coalesce(${services.nextDueDate}, ${next}::date), ${next}::date)`,
      })
      .where(and(eq(services.id, it.serviceId), sql`${services.billingCycle} <> 'onetime'`));
  }
}

/** draft/unpaid → cancelled. Applied credit is returned to the client; lines are detached from services. */
export async function cancelInvoice(
  db: Executor,
  invoiceId: string,
  opts: { reason?: string | null; now?: Date } = {},
): Promise<InvoiceWithItems> {
  return inTx(db, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw notFoundError('Invoice');
    if (!['draft', 'unpaid', 'collections'].includes(inv.status)) {
      throw new BillingError('invoice_not_cancellable', `Invoice is ${inv.status}`);
    }
    const paid = paidAmount(await invoiceTransactions(tx, invoiceId));
    if (paid > 0) {
      // Return credit + partial payments to the balance so nothing is lost.
      await tx
        .update(clients)
        .set({ creditBalance: sql`${clients.creditBalance} + ${paid}` })
        .where(eq(clients.id, inv.clientId));
      await tx.insert(transactions).values({
        clientId: inv.clientId,
        invoiceId,
        gateway: 'credit',
        type: 'refund',
        amount: paid,
        currency: inv.currency,
        description: `Invoice ${inv.number ?? inv.id} cancelled: amount returned to credit balance`,
      });
    }
    // Free the (service, period) slot so a replacement invoice can be generated.
    await tx
      .update(invoiceItems)
      .set({ serviceId: null, domainId: null })
      .where(eq(invoiceItems.invoiceId, invoiceId));
    await tx
      .update(invoices)
      .set({
        status: 'cancelled',
        notes: opts.reason
          ? `${inv.notes ? `${inv.notes}\n` : ''}Cancelled: ${opts.reason}`
          : inv.notes,
      })
      .where(eq(invoices.id, invoiceId));
    return getInvoice(tx, invoiceId);
  });
}

export interface CreditNoteInput {
  reason: string;
  items?: DraftItemInput[];
  addToCreditBalance?: boolean;
  now?: Date;
}

export interface CreditNoteWithItems extends CreditNoteRow {
  items: Array<typeof creditNoteItems.$inferSelect>;
}

/** Credit note against a paid invoice. Full credit (no items given) marks the invoice `refunded`. */
export async function createCreditNote(
  db: Executor,
  invoiceId: string,
  input: CreditNoteInput,
): Promise<CreditNoteWithItems> {
  const now = input.now ?? new Date();
  const today = toIsoDate(now);
  return inTx(db, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw notFoundError('Invoice');
    if (!['paid', 'refunded'].includes(inv.status)) {
      throw new BillingError(
        'invoice_not_creditable',
        'Credit notes can only be issued for paid invoices; cancel unpaid invoices instead',
      );
    }
    const [client] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, inv.clientId))
      .for('update');
    if (!client) throw notFoundError('Client');
    const settings = await loadSettings(tx);
    const existing = await tx
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceItems.sortOrder));
    const full = !input.items;
    const source: DraftItemInput[] =
      input.items ??
      existing.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitAmount: i.unitAmount,
        taxRate: i.taxRate,
        serviceId: i.serviceId,
        domainId: i.domainId,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        sortOrder: i.sortOrder,
      }));
    const decision = await clientTaxDecision(tx, client, settings, today);
    const lines = itemRates(source, {
      ...decision,
      rate: inv.taxRate,
      reverseCharge: inv.reverseCharge,
    });
    const totals = calculateInvoice(lines, inv.currency);
    if (totals.total <= 0)
      throw new BillingError('credit_note_empty', 'Credit note total must be positive', 400);
    const alreadyCredited = await tx
      .select({ sum: sql<number>`coalesce(sum(${creditNotes.total}), 0)::bigint` })
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, invoiceId));
    if (Number(alreadyCredited[0]?.sum ?? 0) + totals.total > inv.total) {
      throw new BillingError(
        'credit_note_exceeds_invoice',
        'Credit notes exceed the invoice total',
        400,
      );
    }
    const number = await takeNextNumber(tx, 'credit_note', today);
    const [note] = await tx
      .insert(creditNotes)
      .values({
        clientId: inv.clientId,
        invoiceId,
        number,
        issueDate: today,
        currency: inv.currency,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        taxRate: totals.taxRate,
        taxSummary: totals.taxSummary,
        reverseCharge: inv.reverseCharge,
        billingSnapshot:
          inv.billingSnapshot ?? (await billingSnapshot(tx, client, settings, decision)),
        reason: input.reason,
      })
      .returning();
    if (!note) throw new Error('insert credit note failed');
    const items = await tx
      .insert(creditNoteItems)
      .values(
        totals.lines.map((l, i) => ({
          creditNoteId: note.id,
          description: l.description ?? '',
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          taxRate: l.taxRate,
          amount: l.amount,
          serviceId: lines[i]?.serviceId ?? null,
          domainId: lines[i]?.domainId ?? null,
          periodStart: lines[i]?.periodStart ?? null,
          periodEnd: lines[i]?.periodEnd ?? null,
          sortOrder: i,
        })),
      )
      .returning();
    await tx.insert(transactions).values({
      clientId: inv.clientId,
      invoiceId,
      gateway: input.addToCreditBalance === false ? 'manual' : 'credit',
      type: 'refund',
      amount: totals.total,
      currency: inv.currency,
      description: `Credit note ${number}: ${input.reason}`,
      createdAt: now,
    });
    if (input.addToCreditBalance !== false) {
      await tx
        .update(clients)
        .set({ creditBalance: sql`${clients.creditBalance} + ${totals.total}` })
        .where(eq(clients.id, inv.clientId));
    }
    if (full || Number(alreadyCredited[0]?.sum ?? 0) + totals.total >= inv.total) {
      await tx.update(invoices).set({ status: 'refunded' }).where(eq(invoices.id, invoiceId));
    }
    return { ...note, items };
  });
}

export async function getCreditNote(db: Executor, id: string): Promise<CreditNoteWithItems> {
  const [note] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
  if (!note) throw notFoundError('Credit note');
  const items = await db
    .select()
    .from(creditNoteItems)
    .where(eq(creditNoteItems.creditNoteId, id))
    .orderBy(asc(creditNoteItems.sortOrder));
  return { ...note, items };
}

/**
 * Late fee: a separate, immediately issued invoice referencing the overdue one (issued invoices are
 * immutable under NL rules). Marks the original so the fee is charged once.
 */
export async function createLateFeeInvoice(
  db: Executor,
  invoiceId: string,
  amount: number,
  opts: { now?: Date } = {},
): Promise<InvoiceWithItems> {
  const now = opts.now ?? new Date();
  return inTx(db, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw notFoundError('Invoice');
    if (inv.lateFeeAppliedAt)
      throw new BillingError('late_fee_applied', 'Late fee already charged');
    if (!OPEN_STATUSES.includes(inv.status as (typeof OPEN_STATUSES)[number])) {
      throw new BillingError('invoice_not_open', `Invoice is ${inv.status}`);
    }
    const client = await getClient(tx, inv.clientId);
    const nl = client.language.toLowerCase().startsWith('nl');
    const draft = await createDraftInvoice(tx, {
      clientId: inv.clientId,
      parentInvoiceId: inv.id,
      dueDate: toIsoDate(now),
      items: [
        {
          description: nl
            ? `Administratiekosten te late betaling factuur ${inv.number}`
            : `Late payment fee for invoice ${inv.number}`,
          unitAmount: amount,
          taxable: true,
        },
      ],
      now,
    });
    const issued = await issueInvoice(tx, draft.id, { now });
    await tx.update(invoices).set({ lateFeeAppliedAt: now }).where(eq(invoices.id, invoiceId));
    return issued.invoice;
  });
}

/** Manual credit balance adjustment (positive = add, negative = deduct). Balance can not go negative. */
export async function adjustCredit(
  db: Executor,
  clientId: string,
  input: { amount: number; description: string; gateway?: string; now?: Date },
): Promise<{ transaction: TransactionRow; creditBalance: number }> {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
    throw new BillingError('invalid_amount', 'Adjustment must be a non-zero integer', 400);
  }
  return inTx(db, async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId)).for('update');
    if (!client) throw notFoundError('Client');
    const next = client.creditBalance + input.amount;
    if (next < 0)
      throw new BillingError('insufficient_credit', 'Credit balance can not go negative', 400);
    await tx.update(clients).set({ creditBalance: next }).where(eq(clients.id, clientId));
    const [txn] = await tx
      .insert(transactions)
      .values({
        clientId,
        invoiceId: null,
        gateway: input.gateway ?? 'manual',
        type: 'credit',
        amount: input.amount,
        currency: client.currency,
        description: input.description,
        createdAt: input.now ?? new Date(),
      })
      .returning();
    if (!txn) throw new Error('insert transaction failed');
    return { transaction: txn, creditBalance: next };
  });
}

/** Sum of credit-type transactions is the audit trail; this re-derives a client balance from it. */
export async function auditCreditBalance(db: Executor, clientId: string): Promise<number> {
  const rows = await db
    .select({
      type: transactions.type,
      amount: transactions.amount,
      gateway: transactions.gateway,
      invoiceId: transactions.invoiceId,
    })
    .from(transactions)
    .where(eq(transactions.clientId, clientId));
  let balance = 0;
  for (const r of rows) {
    if (r.type === 'credit' && !r.invoiceId)
      balance += r.amount; // adjustments
    else if (r.type === 'credit' && r.invoiceId)
      balance -= r.amount; // applied to an invoice
    else if (r.type === 'refund' && r.gateway === 'credit') balance += r.amount; // credit notes / cancellations
  }
  return balance;
}

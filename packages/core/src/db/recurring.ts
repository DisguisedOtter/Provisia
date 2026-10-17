import { clients, domains, invoiceItems, products, services } from '@provisia/db';
import { and, eq, gt, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { domainPeriodStartingAt, periodStartingAt } from '../cycles.js';
import { addDays, type IsoDate, maxIsoDate, toIsoDate } from '../dates.js';
import { createDraftInvoice, type DraftItemInput, issueInvoice } from './invoices.js';
import { loadSettings } from './settings.js';
import type { Executor } from './types.js';

export interface GenerateOptions {
  now?: Date;
  /** Overrides `billing.invoiceDaysBeforeDue`. */
  daysAhead?: number;
  /** Restrict to one client (admin "generate now"). */
  clientId?: string;
}

export interface GenerateResult {
  horizon: IsoDate;
  created: Array<{
    invoiceId: string;
    clientId: string;
    number: string | null;
    total: number;
    serviceIds: string[];
    domainIds: string[];
  }>;
  skipped: Array<{ clientId: string; reason: string }>;
}

interface Candidate {
  clientId: string;
  item: DraftItemInput;
  dueDate: IsoDate;
  serviceId?: string;
  domainId?: string;
}

function describe(
  name: string,
  extra: string | null,
  start: IsoDate,
  end: IsoDate,
  nl: boolean,
): string {
  const label = extra ? `${name} – ${extra}` : name;
  return nl ? `${label} (${start} t/m ${end})` : `${label} (${start} – ${end})`;
}

/**
 * Creates and issues one invoice per client for every active service/domain whose next due date falls
 * within `daysAhead`. Idempotent: lines already invoiced for the same (service, period start) are
 * skipped, and the partial unique index on invoice_items guards races between overlapping runs.
 */
export async function generateRecurringInvoices(
  db: Executor,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const today = toIsoDate(now);
  const settings = await loadSettings(db);
  const daysAhead = opts.daysAhead ?? settings['billing.invoiceDaysBeforeDue'];
  const horizon = addDays(today, daysAhead);

  const svcRows = await db
    .select({
      id: services.id,
      clientId: services.clientId,
      billingCycle: services.billingCycle,
      recurringAmount: services.recurringAmount,
      nextDueDate: services.nextDueDate,
      registrationDate: services.registrationDate,
      domain: services.domain,
      productName: products.name,
      taxable: products.taxable,
      language: clients.language,
      clientStatus: clients.status,
    })
    .from(services)
    .innerJoin(products, eq(products.id, services.productId))
    .innerJoin(clients, eq(clients.id, services.clientId))
    .where(
      and(
        eq(services.status, 'active'),
        ne(services.billingCycle, 'onetime'),
        isNotNull(services.nextDueDate),
        lte(services.nextDueDate, horizon),
        gt(services.recurringAmount, 0),
        isNull(services.cancellationRequestedAt),
        opts.clientId ? eq(services.clientId, opts.clientId) : undefined,
      ),
    );

  const domRows = await db
    .select({
      id: domains.id,
      clientId: domains.clientId,
      name: domains.name,
      nextDueDate: domains.nextDueDate,
      registrationPeriod: domains.registrationPeriod,
      recurringAmount: domains.recurringAmount,
      language: clients.language,
      clientStatus: clients.status,
    })
    .from(domains)
    .innerJoin(clients, eq(clients.id, domains.clientId))
    .where(
      and(
        eq(domains.status, 'active'),
        eq(domains.autoRenew, true),
        isNotNull(domains.nextDueDate),
        lte(domains.nextDueDate, horizon),
        gt(domains.recurringAmount, 0),
        opts.clientId ? eq(domains.clientId, opts.clientId) : undefined,
      ),
    );

  const candidates: Candidate[] = [];
  for (const s of svcRows) {
    if (!s.nextDueDate || s.clientStatus === 'closed') continue;
    const [already] = await db
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.serviceId, s.id), eq(invoiceItems.periodStart, s.nextDueDate)))
      .limit(1);
    if (already) continue;
    const anchor = Number(s.registrationDate.slice(8, 10));
    const period = periodStartingAt(s.nextDueDate, s.billingCycle, anchor);
    const nl = s.language.toLowerCase().startsWith('nl');
    candidates.push({
      clientId: s.clientId,
      serviceId: s.id,
      dueDate: s.nextDueDate,
      item: {
        description: describe(s.productName, s.domain, period.start, period.end, nl),
        unitAmount: s.recurringAmount,
        taxable: s.taxable,
        serviceId: s.id,
        periodStart: period.start,
        periodEnd: period.end,
      },
    });
  }
  for (const d of domRows) {
    if (!d.nextDueDate || d.clientStatus === 'closed') continue;
    const [already] = await db
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.domainId, d.id), eq(invoiceItems.periodStart, d.nextDueDate)))
      .limit(1);
    if (already) continue;
    const years = Math.max(1, d.registrationPeriod);
    const period = domainPeriodStartingAt(d.nextDueDate, years);
    const nl = d.language.toLowerCase().startsWith('nl');
    candidates.push({
      clientId: d.clientId,
      domainId: d.id,
      dueDate: d.nextDueDate,
      item: {
        description: nl
          ? `Domeinverlenging ${d.name} (${years} jaar, ${period.start} t/m ${period.end})`
          : `Domain renewal ${d.name} (${years} year${years > 1 ? 's' : ''}, ${period.start} – ${period.end})`,
        unitAmount: d.recurringAmount,
        taxable: true,
        domainId: d.id,
        periodStart: period.start,
        periodEnd: period.end,
      },
    });
  }

  const byClient = new Map<string, Candidate[]>();
  for (const c of candidates) byClient.set(c.clientId, [...(byClient.get(c.clientId) ?? []), c]);

  const result: GenerateResult = { horizon, created: [], skipped: [] };
  for (const [clientId, list] of byClient) {
    const dueDate = maxIsoDate(list.map((c) => c.dueDate).sort()[0] ?? today, today);
    try {
      const issued = await db.transaction(async (tx) => {
        const draft = await createDraftInvoice(tx, {
          clientId,
          dueDate,
          items: list.map((c, i) => ({ ...c.item, sortOrder: i })),
          now,
        });
        return issueInvoice(tx, draft.id, { now });
      });
      result.created.push({
        invoiceId: issued.invoice.id,
        clientId,
        number: issued.invoice.number,
        total: issued.invoice.total,
        serviceIds: list.map((c) => c.serviceId).filter((x): x is string => !!x),
        domainIds: list.map((c) => c.domainId).filter((x): x is string => !!x),
      });
    } catch (err) {
      // Unique violation = a concurrent run already invoiced this period; anything else is reported.
      const code =
        (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      result.skipped.push({
        clientId,
        reason:
          code === '23505' ? 'already_invoiced' : err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/** Services whose invoice for the upcoming period exists already (for the admin UI / tests). */
export async function isPeriodInvoiced(
  db: Executor,
  serviceId: string,
  periodStart: IsoDate,
): Promise<boolean> {
  const [row] = await db
    .select({ id: invoiceItems.id })
    .from(invoiceItems)
    .where(
      and(
        eq(invoiceItems.serviceId, serviceId),
        eq(invoiceItems.periodStart, periodStart),
        sql`true`,
      ),
    )
    .limit(1);
  return !!row;
}

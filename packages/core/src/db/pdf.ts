import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { clients, creditNotes, invoices, users } from '@provisia/db';
import type { Settings } from '@provisia/shared';
import { eq } from 'drizzle-orm';
import { paidAmount } from '../credit.js';
import {
  type InvoicePdfData,
  type PdfClient,
  type PdfCompany,
  pdfLanguageFor,
  renderInvoicePdf,
} from '../pdf/index.js';
import { getCreditNote, getInvoice, invoiceTransactions } from './invoices.js';
import { loadSettings } from './settings.js';
import type { Executor } from './types.js';
import { notFoundError } from './types.js';

function company(s: Settings): PdfCompany {
  return {
    name: s['company.name'],
    legalName: s['company.legalName'],
    address: s['company.address'],
    country: s['company.country'],
    vatNumber: s['company.vatNumber'],
    kvk: s['company.kvk'],
    email: s['company.email'],
    phone: s['company.phone'],
    website: s['company.website'],
    iban: s['company.iban'],
    bic: s['company.bic'],
  };
}

async function clientBlock(
  db: Executor,
  clientId: string,
  snapshot: Record<string, unknown> | null,
): Promise<{ client: PdfClient; language: string }> {
  const snap = (snapshot?.client ?? null) as Record<string, unknown> | null;
  const [row] = await db
    .select({
      client: clients,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId));
  if (!row) throw notFoundError('Client');
  const c = row.client;
  const str = (k: string, fallback: string | null): string | null =>
    snap && typeof snap[k] === 'string' ? (snap[k] as string) : fallback;
  return {
    language: str('language', c.language) ?? 'en',
    client: {
      name: str('name', `${row.firstName} ${row.lastName}`.trim()) ?? '',
      companyName: str('companyName', c.companyName),
      address1: str('address1', c.address1) ?? '',
      address2: str('address2', c.address2),
      postalCode: str('postalCode', c.postalCode) ?? '',
      city: str('city', c.city) ?? '',
      state: str('state', c.state),
      country: str('country', c.country) ?? c.country,
      vatNumber: str('vatNumber', c.vatNumber),
      email: row.email,
    },
  };
}

export async function buildInvoicePdfData(
  db: Executor,
  invoiceId: string,
  settings?: Settings,
): Promise<InvoicePdfData> {
  const s = settings ?? (await loadSettings(db));
  const inv = await getInvoice(db, invoiceId);
  const { client, language } = await clientBlock(db, inv.clientId, inv.billingSnapshot ?? null);
  const lang = pdfLanguageFor(language, s['billing.invoicePdfLanguage']);
  const paid = paidAmount(await invoiceTransactions(db, invoiceId));
  const snapTax = (inv.billingSnapshot?.tax ?? null) as {
    note?: { en: string; nl: string } | null;
  } | null;
  const note = snapTax?.note ? snapTax.note[lang] : null;
  return {
    kind: 'invoice',
    language: lang,
    company: company(s),
    client,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    status: inv.status,
    paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
    currency: inv.currency,
    lines: inv.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitAmount: i.unitAmount,
      taxRate: i.taxRate,
      amount: i.amount,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
    })),
    subtotal: inv.subtotal,
    taxSummary: inv.taxSummary ?? [],
    taxTotal: inv.taxTotal,
    total: inv.total,
    creditApplied: inv.creditApplied,
    paidAmount: Math.max(0, paid - inv.creditApplied),
    amountDue: inv.status === 'cancelled' ? 0 : Math.max(0, inv.total - paid),
    reverseCharge: inv.reverseCharge,
    taxNote:
      note ??
      (inv.reverseCharge ? (lang === 'nl' ? 'BTW verlegd.' : 'VAT reverse charged.') : null),
    notes: inv.notes,
    footer: s['billing.invoiceFooter'] || null,
  };
}

export async function buildCreditNotePdfData(
  db: Executor,
  creditNoteId: string,
  settings?: Settings,
): Promise<InvoicePdfData> {
  const s = settings ?? (await loadSettings(db));
  const note = await getCreditNote(db, creditNoteId);
  const { client, language } = await clientBlock(db, note.clientId, note.billingSnapshot ?? null);
  const lang = pdfLanguageFor(language, s['billing.invoicePdfLanguage']);
  const [inv] = note.invoiceId
    ? await db
        .select({ number: invoices.number })
        .from(invoices)
        .where(eq(invoices.id, note.invoiceId))
    : [];
  const snapTax = (note.billingSnapshot?.tax ?? null) as {
    note?: { en: string; nl: string } | null;
  } | null;
  return {
    kind: 'credit_note',
    language: lang,
    company: company(s),
    client,
    number: note.number,
    issueDate: note.issueDate,
    dueDate: null,
    status: 'paid',
    paidAt: null,
    relatedInvoiceNumber: inv?.number ?? null,
    currency: note.currency,
    lines: note.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitAmount: -i.unitAmount,
      taxRate: i.taxRate,
      amount: -i.amount,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
    })),
    subtotal: -note.subtotal,
    taxSummary: (note.taxSummary ?? []).map((t) => ({ ...t, base: -t.base, tax: -t.tax })),
    taxTotal: -note.taxTotal,
    total: -note.total,
    creditApplied: 0,
    paidAmount: 0,
    amountDue: 0,
    reverseCharge: note.reverseCharge,
    taxNote: snapTax?.note ? snapTax.note[lang] : null,
    notes: note.reason,
    footer: s['billing.invoiceFooter'] || null,
  };
}

export interface StoredPdf {
  /** Path relative to the storage root, as persisted in `pdf_path`. */
  path: string;
  absolutePath: string;
  buffer: Buffer;
}

export function resolveStorageRoot(explicit?: string | null, settings?: Settings): string {
  const root = explicit || process.env.STORAGE_PATH || settings?.['storage.localPath'] || 'storage';
  return isAbsolute(root) ? root : resolve(process.cwd(), root);
}

async function persist(root: string, relative: string, buffer: Buffer): Promise<StoredPdf> {
  const absolutePath = join(root, relative);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  return { path: relative, absolutePath, buffer };
}

/** Renders the invoice PDF, writes it under `<root>/invoices/<year>/<number>.pdf` and records `pdf_path`. */
export async function storeInvoicePdf(
  db: Executor,
  invoiceId: string,
  opts: { storageRoot?: string | null; settings?: Settings } = {},
): Promise<StoredPdf> {
  const settings = opts.settings ?? (await loadSettings(db));
  const data = await buildInvoicePdfData(db, invoiceId, settings);
  const buffer = await renderInvoicePdf(data);
  const year = (data.issueDate ?? new Date().toISOString()).slice(0, 4);
  const name = data.number ?? `draft-${invoiceId}`;
  const stored = await persist(
    resolveStorageRoot(opts.storageRoot, settings),
    join('invoices', year, `${name}.pdf`),
    buffer,
  );
  await db.update(invoices).set({ pdfPath: stored.path }).where(eq(invoices.id, invoiceId));
  return stored;
}

export async function storeCreditNotePdf(
  db: Executor,
  creditNoteId: string,
  opts: { storageRoot?: string | null; settings?: Settings } = {},
): Promise<StoredPdf> {
  const settings = opts.settings ?? (await loadSettings(db));
  const data = await buildCreditNotePdfData(db, creditNoteId, settings);
  const buffer = await renderInvoicePdf(data);
  const year = (data.issueDate ?? new Date().toISOString()).slice(0, 4);
  const stored = await persist(
    resolveStorageRoot(opts.storageRoot, settings),
    join('credit-notes', year, `${data.number}.pdf`),
    buffer,
  );
  await db
    .update(creditNotes)
    .set({ pdfPath: stored.path })
    .where(eq(creditNotes.id, creditNoteId));
  return stored;
}

export type PdfLanguage = 'en' | 'nl';

const STRINGS = {
  invoice: { en: 'Invoice', nl: 'Factuur' },
  creditNote: { en: 'Credit note', nl: 'Creditnota' },
  proforma: { en: 'Pro forma (draft)', nl: 'Pro forma (concept)' },
  invoiceNumber: { en: 'Invoice number', nl: 'Factuurnummer' },
  creditNoteNumber: { en: 'Credit note number', nl: 'Creditnotanummer' },
  issueDate: { en: 'Invoice date', nl: 'Factuurdatum' },
  dueDate: { en: 'Due date', nl: 'Vervaldatum' },
  relatedInvoice: { en: 'Relates to invoice', nl: 'Betreft factuur' },
  billTo: { en: 'Bill to', nl: 'Factuuradres' },
  vatNumber: { en: 'VAT number', nl: 'BTW-nummer' },
  yourVatNumber: { en: 'Your VAT number', nl: 'Uw BTW-nummer' },
  kvk: { en: 'Chamber of Commerce', nl: 'KVK' },
  description: { en: 'Description', nl: 'Omschrijving' },
  period: { en: 'Period', nl: 'Periode' },
  qty: { en: 'Qty', nl: 'Aantal' },
  unitPrice: { en: 'Unit price', nl: 'Prijs' },
  vat: { en: 'VAT', nl: 'BTW' },
  amount: { en: 'Amount', nl: 'Bedrag' },
  subtotal: { en: 'Subtotal (excl. VAT)', nl: 'Subtotaal (excl. BTW)' },
  total: { en: 'Total', nl: 'Totaal' },
  creditApplied: { en: 'Credit applied', nl: 'Verrekend tegoed' },
  paid: { en: 'Paid', nl: 'Betaald' },
  amountDue: { en: 'Amount due', nl: 'Te betalen' },
  paidOn: { en: 'Paid on', nl: 'Betaald op' },
  paymentInstructions: { en: 'Payment details', nl: 'Betaalgegevens' },
  payBy: {
    en: 'Please transfer the amount due before the due date, quoting the invoice number.',
    nl: 'Gelieve het verschuldigde bedrag voor de vervaldatum over te maken onder vermelding van het factuurnummer.',
  },
  reference: { en: 'Reference', nl: 'Kenmerk' },
  notes: { en: 'Notes', nl: 'Opmerkingen' },
  page: { en: 'Page', nl: 'Pagina' },
  of: { en: 'of', nl: 'van' },
  status_paid: { en: 'PAID', nl: 'BETAALD' },
  status_cancelled: { en: 'CANCELLED', nl: 'GEANNULEERD' },
  status_credited: { en: 'CREDITED', nl: 'GECREDITEERD' },
} as const;

export type PdfStringKey = keyof typeof STRINGS;

export function t(lang: PdfLanguage, key: PdfStringKey): string {
  return STRINGS[key][lang];
}

export function pdfLanguageFor(
  clientLanguage: string | null | undefined,
  setting: 'en' | 'nl' | 'client',
): PdfLanguage {
  if (setting !== 'client') return setting;
  return (clientLanguage ?? 'en').toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

/** `2026-01-31` → `31-01-2026` (nl) or `31 Jan 2026` (en). */
export function formatPdfDate(iso: string | null | undefined, lang: PdfLanguage): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  if (lang === 'nl') return `${d}-${m}-${y}`;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

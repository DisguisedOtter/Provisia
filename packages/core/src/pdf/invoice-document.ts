/**
 * Invoice / credit note PDF built with @react-pdf/renderer via `createElement` (no JSX, so no tsconfig
 * changes are needed in consumers). Rendering is pure: data in, Buffer out.
 */
import { formatMoney, toDecimalString } from '@provisia/shared';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { createElement as h, type ReactElement } from 'react';
import { formatPdfDate, type PdfLanguage, t } from './i18n.js';

export interface PdfCompany {
  name: string;
  legalName?: string;
  /** Multi-line address (newline separated). */
  address: string;
  country: string;
  vatNumber?: string;
  kvk?: string;
  email?: string;
  phone?: string;
  website?: string;
  iban?: string;
  bic?: string;
}

export interface PdfClient {
  name: string;
  companyName: string | null;
  address1: string;
  address2: string | null;
  postalCode: string;
  city: string;
  state: string | null;
  country: string;
  vatNumber: string | null;
  email?: string;
}

export interface PdfLine {
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: string;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface InvoicePdfData {
  kind: 'invoice' | 'credit_note';
  language: PdfLanguage;
  company: PdfCompany;
  client: PdfClient;
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  status: string;
  paidAt: string | null;
  /** For credit notes: the invoice they relate to. */
  relatedInvoiceNumber?: string | null;
  currency: string;
  lines: PdfLine[];
  subtotal: number;
  taxSummary: Array<{ rate: string; base: number; tax: number }>;
  taxTotal: number;
  total: number;
  creditApplied: number;
  paidAmount: number;
  amountDue: number;
  reverseCharge: boolean;
  /** Legal VAT note (reverse charge / export) in the document language. */
  taxNote: string | null;
  notes: string | null;
  footer: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  row: { flexDirection: 'row' },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#666' },
  small: { fontSize: 8 },
  block: { marginBottom: 14 },
  label: { color: '#666', fontSize: 8, marginBottom: 2 },
  table: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#111' },
  th: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    fontFamily: 'Helvetica-Bold',
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ccc',
  },
  cDesc: { flex: 5 },
  cQty: { flex: 0.8, textAlign: 'right' },
  cUnit: { flex: 1.5, textAlign: 'right' },
  cVat: { flex: 0.9, textAlign: 'right' },
  cAmt: { flex: 1.6, textAlign: 'right' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalDue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: '#111',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  note: { marginTop: 14, padding: 8, backgroundColor: '#f3f4f6' },
  stamp: {
    position: 'absolute',
    top: 40,
    right: 40,
    borderWidth: 2,
    borderColor: '#b91c1c',
    color: '#b91c1c',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    transform: 'rotate(-8deg)',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#666',
    textAlign: 'center',
  },
});

function money(amount: number, currency: string, lang: PdfLanguage): string {
  try {
    return formatMoney({ amount, currency }, lang === 'nl' ? 'nl-NL' : 'en-IE');
  } catch {
    return `${currency} ${toDecimalString({ amount, currency })}`;
  }
}

function lines(text: string | null | undefined): ReactElement[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => h(Text, { key: `${i}-${l}` }, l));
}

function clientAddress(c: PdfClient): ReactElement[] {
  const out: string[] = [];
  if (c.companyName) out.push(c.companyName);
  out.push(c.name);
  if (c.address1) out.push(c.address1);
  if (c.address2) out.push(c.address2);
  const cityLine = [c.postalCode, c.city].filter(Boolean).join(' ');
  if (cityLine) out.push(cityLine);
  if (c.state) out.push(c.state);
  out.push(c.country);
  return out.map((l, i) => h(Text, { key: `${i}-${l}` }, l));
}

export function InvoiceDocument(d: InvoicePdfData): ReactElement {
  const L = d.language;
  const isCredit = d.kind === 'credit_note';
  const title = d.number ? (isCredit ? t(L, 'creditNote') : t(L, 'invoice')) : t(L, 'proforma');
  const stamp =
    d.status === 'paid' && !isCredit
      ? t(L, 'status_paid')
      : d.status === 'cancelled'
        ? t(L, 'status_cancelled')
        : d.status === 'refunded'
          ? t(L, 'status_credited')
          : null;

  const header = h(View, { style: [styles.between, styles.block] }, [
    h(View, { key: 'co' }, [
      h(Text, { key: 'n', style: [styles.h1] }, d.company.name),
      ...lines(
        d.company.legalName && d.company.legalName !== d.company.name ? d.company.legalName : null,
      ),
      ...lines(d.company.address),
      h(Text, { key: 'c' }, d.company.country),
      ...(d.company.email ? [h(Text, { key: 'e', style: styles.muted }, d.company.email)] : []),
      ...(d.company.website ? [h(Text, { key: 'w', style: styles.muted }, d.company.website)] : []),
    ]),
    h(View, { key: 'meta', style: { alignItems: 'flex-end' } }, [
      h(Text, { key: 't', style: styles.h1 }, title),
      h(
        Text,
        { key: 'nl', style: styles.label },
        isCredit ? t(L, 'creditNoteNumber') : t(L, 'invoiceNumber'),
      ),
      h(Text, { key: 'nv', style: styles.bold }, d.number ?? '—'),
      h(Text, { key: 'dl', style: styles.label }, t(L, 'issueDate')),
      h(Text, { key: 'dv' }, formatPdfDate(d.issueDate, L) || '—'),
      ...(isCredit
        ? d.relatedInvoiceNumber
          ? [
              h(Text, { key: 'rl', style: styles.label }, t(L, 'relatedInvoice')),
              h(Text, { key: 'rv' }, d.relatedInvoiceNumber),
            ]
          : []
        : [
            h(Text, { key: 'ddl', style: styles.label }, t(L, 'dueDate')),
            h(Text, { key: 'ddv' }, formatPdfDate(d.dueDate, L) || '—'),
          ]),
    ]),
  ]);

  const parties = h(View, { style: [styles.between, styles.block] }, [
    h(View, { key: 'client' }, [
      h(Text, { key: 'l', style: styles.label }, t(L, 'billTo')),
      ...clientAddress(d.client),
      ...(d.client.vatNumber
        ? [
            h(
              Text,
              { key: 'v', style: { marginTop: 3 } },
              `${t(L, 'yourVatNumber')}: ${d.client.vatNumber}`,
            ),
          ]
        : []),
    ]),
    h(View, { key: 'ids', style: { alignItems: 'flex-end' } }, [
      ...(d.company.vatNumber
        ? [
            h(
              Text,
              { key: 'v', style: styles.small },
              `${t(L, 'vatNumber')}: ${d.company.vatNumber}`,
            ),
          ]
        : []),
      ...(d.company.kvk
        ? [h(Text, { key: 'k', style: styles.small }, `${t(L, 'kvk')}: ${d.company.kvk}`)]
        : []),
    ]),
  ]);

  const table = h(View, { style: styles.table }, [
    h(View, { key: 'head', style: styles.th }, [
      h(Text, { key: 'd', style: styles.cDesc }, t(L, 'description')),
      h(Text, { key: 'q', style: styles.cQty }, t(L, 'qty')),
      h(Text, { key: 'u', style: styles.cUnit }, t(L, 'unitPrice')),
      h(Text, { key: 'v', style: styles.cVat }, t(L, 'vat')),
      h(Text, { key: 'a', style: styles.cAmt }, t(L, 'amount')),
    ]),
    ...d.lines.map((line, i) =>
      h(View, { key: `l${i}`, style: styles.tr, wrap: false }, [
        h(View, { key: 'd', style: styles.cDesc }, [
          h(Text, { key: 't' }, line.description),
          ...(line.periodStart && line.periodEnd
            ? [
                h(
                  Text,
                  { key: 'p', style: [styles.muted, styles.small] },
                  `${t(L, 'period')}: ${formatPdfDate(line.periodStart, L)} – ${formatPdfDate(line.periodEnd, L)}`,
                ),
              ]
            : []),
        ]),
        h(Text, { key: 'q', style: styles.cQty }, String(line.quantity)),
        h(Text, { key: 'u', style: styles.cUnit }, money(line.unitAmount, d.currency, L)),
        h(Text, { key: 'v', style: styles.cVat }, `${line.taxRate.replace(/\.00$/, '')}%`),
        h(Text, { key: 'a', style: styles.cAmt }, money(line.amount, d.currency, L)),
      ]),
    ),
  ]);

  const totalRows: ReactElement[] = [
    h(View, { key: 'sub', style: styles.totalRow }, [
      h(Text, { key: 'l' }, t(L, 'subtotal')),
      h(Text, { key: 'v' }, money(d.subtotal, d.currency, L)),
    ]),
    ...d.taxSummary.map((s) =>
      h(View, { key: `tax${s.rate}`, style: styles.totalRow }, [
        h(
          Text,
          { key: 'l' },
          `${t(L, 'vat')} ${s.rate.replace(/\.00$/, '')}% (${money(s.base, d.currency, L)})`,
        ),
        h(Text, { key: 'v' }, money(s.tax, d.currency, L)),
      ]),
    ),
    ...(d.taxSummary.length === 0
      ? [
          h(View, { key: 'tax0', style: styles.totalRow }, [
            h(Text, { key: 'l' }, `${t(L, 'vat')} 0%`),
            h(Text, { key: 'v' }, money(0, d.currency, L)),
          ]),
        ]
      : []),
    h(View, { key: 'tot', style: styles.totalRow }, [
      h(Text, { key: 'l', style: styles.bold }, t(L, 'total')),
      h(Text, { key: 'v', style: styles.bold }, money(d.total, d.currency, L)),
    ]),
  ];
  if (!isCredit) {
    if (d.creditApplied > 0) {
      totalRows.push(
        h(View, { key: 'cr', style: styles.totalRow }, [
          h(Text, { key: 'l' }, t(L, 'creditApplied')),
          h(Text, { key: 'v' }, money(-d.creditApplied, d.currency, L)),
        ]),
      );
    }
    if (d.paidAmount > 0) {
      totalRows.push(
        h(View, { key: 'pd', style: styles.totalRow }, [
          h(Text, { key: 'l' }, t(L, 'paid')),
          h(Text, { key: 'v' }, money(-d.paidAmount, d.currency, L)),
        ]),
      );
    }
    totalRows.push(
      h(View, { key: 'due', style: styles.totalDue }, [
        h(Text, { key: 'l' }, t(L, 'amountDue')),
        h(Text, { key: 'v' }, money(d.amountDue, d.currency, L)),
      ]),
    );
  }
  const totals = h(View, { style: styles.totals }, totalRows);

  const extras: ReactElement[] = [];
  if (d.taxNote)
    extras.push(h(View, { key: 'taxnote', style: styles.note }, h(Text, {}, d.taxNote)));
  if (!isCredit && d.amountDue > 0 && d.status !== 'cancelled') {
    const pay: ReactElement[] = [
      h(Text, { key: 'h', style: styles.bold }, t(L, 'paymentInstructions')),
      h(Text, { key: 'p' }, t(L, 'payBy')),
    ];
    if (d.company.iban)
      pay.push(
        h(
          Text,
          { key: 'i' },
          `IBAN: ${d.company.iban}${d.company.bic ? `   BIC: ${d.company.bic}` : ''}`,
        ),
      );
    pay.push(h(Text, { key: 'r' }, `${t(L, 'reference')}: ${d.number ?? ''}`));
    extras.push(h(View, { key: 'pay', style: styles.note }, pay));
  }
  if (d.status === 'paid' && d.paidAt && !isCredit) {
    extras.push(
      h(
        Text,
        { key: 'paidon', style: { marginTop: 10 } },
        `${t(L, 'paidOn')}: ${formatPdfDate(d.paidAt.slice(0, 10), L)}`,
      ),
    );
  }
  if (d.notes)
    extras.push(
      h(View, { key: 'notes', style: { marginTop: 12 } }, [
        h(Text, { key: 'h', style: styles.label }, t(L, 'notes')),
        ...lines(d.notes),
      ]),
    );

  const footerText = [
    d.footer,
    [
      d.company.vatNumber && `${t(L, 'vatNumber')} ${d.company.vatNumber}`,
      d.company.kvk && `${t(L, 'kvk')} ${d.company.kvk}`,
      d.company.iban && `IBAN ${d.company.iban}`,
    ]
      .filter(Boolean)
      .join(' · '),
  ]
    .filter(Boolean)
    .join('\n');

  return h(
    Document,
    { title: `${title} ${d.number ?? ''}`.trim(), author: d.company.name, language: L },
    h(Page, { size: 'A4', style: styles.page }, [
      ...(stamp ? [h(Text, { key: 'stamp', style: styles.stamp, fixed: true }, stamp)] : []),
      header,
      parties,
      table,
      totals,
      ...extras,
      h(Text, {
        key: 'footer',
        style: styles.footer,
        fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `${footerText ? `${footerText}\n` : ''}${t(L, 'page')} ${pageNumber} ${t(L, 'of')} ${totalPages}`,
      }),
    ]),
  );
}

/** Renders the document to PDF bytes. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(InvoiceDocument(data) as never);
}

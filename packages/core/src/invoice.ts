import type { Money } from '@provisia/shared';
import {
  basisPointsToPercent,
  percentToBasisPoints,
  roundTaxNumerator,
  taxNumerator,
} from './money.js';

export interface CalcLineInput {
  description?: string;
  quantity: number;
  /** Net unit price in minor units (may be negative for credits/proration). */
  unitAmount: number;
  /** Percent as `"21.00"` or 21. */
  taxRate: string | number;
}

export interface CalcLine extends CalcLineInput {
  taxRate: string;
  /** quantity * unitAmount (net). */
  amount: number;
  /** Informational per-line tax (rounded for display); the invoice total uses per-rate rounding. */
  taxAmount: number;
}

export interface TaxSummaryLine {
  rate: string;
  base: number;
  tax: number;
}

export interface InvoiceTotals {
  lines: CalcLine[];
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  /** One entry per distinct non-zero rate, ordered by rate. */
  taxSummary: TaxSummaryLine[];
  /** Highest rate used (the invoice-level `tax_rate` snapshot), `"0.00"` when untaxed. */
  taxRate: string;
}

/**
 * Lines → totals. Tax is computed exactly per line (integer numerators), summed per rate and rounded
 * half-up once per rate per invoice, so a 100-line invoice at 21% never accumulates cent drift.
 */
export function calculateInvoice(lines: CalcLineInput[], currency = 'EUR'): InvoiceTotals {
  const groups = new Map<number, { base: number; numerator: number }>();
  const out: CalcLine[] = [];
  let subtotal = 0;

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || !Number.isSafeInteger(line.unitAmount)) {
      throw new TypeError('invoice lines need integer quantity and unitAmount');
    }
    const bp = percentToBasisPoints(line.taxRate);
    const amount = line.quantity * line.unitAmount;
    const numerator = taxNumerator(amount, bp);
    subtotal += amount;
    const g = groups.get(bp) ?? { base: 0, numerator: 0 };
    g.base += amount;
    g.numerator += numerator;
    groups.set(bp, g);
    out.push({
      ...line,
      taxRate: basisPointsToPercent(bp),
      amount,
      taxAmount: roundTaxNumerator(numerator),
    });
  }

  const taxSummary: TaxSummaryLine[] = [...groups.entries()]
    .filter(([bp]) => bp !== 0)
    .sort((a, b) => a[0] - b[0])
    .map(([bp, g]) => ({
      rate: basisPointsToPercent(bp),
      base: g.base,
      tax: roundTaxNumerator(g.numerator),
    }));
  const taxTotal = taxSummary.reduce((s, l) => s + l.tax, 0);
  const maxBp = Math.max(0, ...groups.keys());

  return {
    lines: out,
    currency,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    taxSummary,
    taxRate: basisPointsToPercent(maxBp),
  };
}

/** Amount still owed after credit and payments (never negative). */
export function openBalance(total: number, creditApplied: number, paid: number): number {
  return Math.max(0, total - creditApplied - paid);
}

export function totalsAsMoney(t: InvoiceTotals): {
  subtotal: Money;
  taxTotal: Money;
  total: Money;
} {
  return {
    subtotal: { amount: t.subtotal, currency: t.currency },
    taxTotal: { amount: t.taxTotal, currency: t.currency },
    total: { amount: t.total, currency: t.currency },
  };
}

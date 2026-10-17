import { describe, expect, it } from 'vitest';
import { calculateInvoice, openBalance } from './invoice.js';

describe('invoice calculation', () => {
  it('sums lines and taxes per invoice, half-up', () => {
    const t = calculateInvoice([
      { quantity: 1, unitAmount: 499, taxRate: '21.00' },
      { quantity: 1, unitAmount: 499, taxRate: '21.00' },
    ]);
    // per-line rounding would give 105 + 105 = 210; per-invoice: 998 * 0.21 = 209.58 -> 210
    expect(t.subtotal).toBe(998);
    expect(t.taxTotal).toBe(210);
    expect(t.total).toBe(1208);
    expect(t.taxRate).toBe('21.00');
    expect(t.taxSummary).toEqual([{ rate: '21.00', base: 998, tax: 210 }]);
  });
  it('avoids per-line drift on many small lines', () => {
    const lines = Array.from({ length: 100 }, () => ({ quantity: 1, unitAmount: 1, taxRate: 21 }));
    const t = calculateInvoice(lines);
    // 100 cents * 21% = 21 cents exactly; per-line rounding would have produced 0.
    expect(t.taxTotal).toBe(21);
    expect(t.lines[0]?.taxAmount).toBe(0);
  });
  it('rounds exactly half up', () => {
    // 50 * 21% = 10.5 -> 11
    expect(calculateInvoice([{ quantity: 1, unitAmount: 50, taxRate: '21.00' }]).taxTotal).toBe(11);
    // 250 * 9% = 22.5 -> 23
    expect(calculateInvoice([{ quantity: 1, unitAmount: 250, taxRate: '9.00' }]).taxTotal).toBe(23);
  });
  it('groups by rate and reports the highest as the invoice rate', () => {
    const t = calculateInvoice([
      { quantity: 2, unitAmount: 1000, taxRate: '21.00' },
      { quantity: 1, unitAmount: 1000, taxRate: '9.00' },
      { quantity: 1, unitAmount: 500, taxRate: '0.00' },
    ]);
    expect(t.subtotal).toBe(3500);
    expect(t.taxSummary).toEqual([
      { rate: '9.00', base: 1000, tax: 90 },
      { rate: '21.00', base: 2000, tax: 420 },
    ]);
    expect(t.taxTotal).toBe(510);
    expect(t.taxRate).toBe('21.00');
  });
  it('handles negative (credit) lines and zero-tax invoices', () => {
    const t = calculateInvoice([
      { quantity: 1, unitAmount: 1000, taxRate: '21.00' },
      { quantity: 1, unitAmount: -400, taxRate: '21.00' },
    ]);
    expect(t.subtotal).toBe(600);
    expect(t.taxTotal).toBe(126);
    const rc = calculateInvoice([{ quantity: 3, unitAmount: 333, taxRate: '0.00' }]);
    expect(rc).toMatchObject({
      subtotal: 999,
      taxTotal: 0,
      total: 999,
      taxRate: '0.00',
      taxSummary: [],
    });
  });
  it('rejects non-integer money', () => {
    expect(() => calculateInvoice([{ quantity: 1, unitAmount: 4.99, taxRate: 21 }])).toThrow();
  });
  it('open balance never goes negative', () => {
    expect(openBalance(1000, 300, 500)).toBe(200);
    expect(openBalance(1000, 300, 900)).toBe(0);
  });
});

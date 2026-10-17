import { describe, expect, it } from 'vitest';
import {
  findNumberingGaps,
  formatDocumentNumber,
  formatInvoiceNumber,
  nextDocumentNumber,
  nextInvoiceNumber,
  parseDocumentNumber,
} from './numbering.js';

describe('invoice numbering', () => {
  it('formats YYYY-NNNNNN and widens beyond six digits', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('2026-000001');
    expect(formatInvoiceNumber(2026, 999999)).toBe('2026-999999');
    expect(formatInvoiceNumber(2026, 1000000)).toBe('2026-1000000');
    expect(formatDocumentNumber('credit_note', 2026, 7)).toBe('CN-2026-000007');
    expect(formatDocumentNumber('order', 2026, 7)).toBe('ORD-2026-000007');
    expect(() => formatInvoiceNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatInvoiceNumber(2026, 1.5)).toThrow(RangeError);
  });
  it('parses numbers back', () => {
    expect(parseDocumentNumber('2026-000042')).toEqual({
      kind: 'invoice',
      year: 2026,
      sequence: 42,
    });
    expect(parseDocumentNumber('CN-2026-000042')).toEqual({
      kind: 'credit_note',
      year: 2026,
      sequence: 42,
    });
    expect(parseDocumentNumber('INV-1')).toBeNull();
  });
  it('is sequential and gap-free within a year', () => {
    let counter = null as { year: number; lastNumber: number } | null;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const n = nextInvoiceNumber('2026-03-01', counter);
      counter = n.counter;
      seen.push(n.number);
    }
    expect(seen).toEqual([
      '2026-000001',
      '2026-000002',
      '2026-000003',
      '2026-000004',
      '2026-000005',
    ]);
    expect(findNumberingGaps(seen, 'invoice', 2026)).toEqual([]);
  });
  it('restarts at 1 in a new year, keyed on the issue date', () => {
    const n = nextInvoiceNumber('2027-01-01', { year: 2026, lastNumber: 4321 });
    expect(n.number).toBe('2027-000001');
    expect(n.counter).toEqual({ year: 2027, lastNumber: 1 });
    // Back-dated issue in the previous year continues that year's counter.
    const back = nextInvoiceNumber('2026-12-31', { year: 2026, lastNumber: 4321 });
    expect(back.number).toBe('2026-004322');
  });
  it('credit notes have their own sequence', () => {
    const n = nextDocumentNumber('credit_note', '2026-05-05', null);
    expect(n.number).toBe('CN-2026-000001');
  });
  it('detects gaps', () => {
    expect(
      findNumberingGaps(['2026-000001', '2026-000002', '2026-000005'], 'invoice', 2026),
    ).toEqual([3, 4]);
    expect(findNumberingGaps(['2026-000002'], 'invoice', 2026)).toEqual([1]);
    expect(findNumberingGaps(['CN-2026-000002', '2026-000001'], 'invoice', 2026)).toEqual([]);
  });
});

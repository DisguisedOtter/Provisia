import type { IsoDate } from './dates.js';
import { yearOf } from './dates.js';

export type DocumentKind = 'invoice' | 'credit_note' | 'order';

const PREFIX: Record<DocumentKind, string> = { invoice: '', credit_note: 'CN-', order: 'ORD-' };
const WIDTH = 6;

/** `2026-000001`, `CN-2026-000001`, `ORD-2026-000001`. Sequence widens beyond 999999 rather than wrapping. */
export function formatDocumentNumber(kind: DocumentKind, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`sequence must be a positive integer, got ${sequence}`);
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`year out of range: ${year}`);
  }
  return `${PREFIX[kind]}${year}-${String(sequence).padStart(WIDTH, '0')}`;
}

export function formatInvoiceNumber(year: number, sequence: number): string {
  return formatDocumentNumber('invoice', year, sequence);
}

export interface ParsedNumber {
  kind: DocumentKind;
  year: number;
  sequence: number;
}

export function parseDocumentNumber(value: string): ParsedNumber | null {
  const m = /^(CN-|ORD-)?(\d{4})-(\d{6,})$/.exec(value);
  if (!m) return null;
  const kind: DocumentKind = m[1] === 'CN-' ? 'credit_note' : m[1] === 'ORD-' ? 'order' : 'invoice';
  return { kind, year: Number(m[2]), sequence: Number(m[3]) };
}

export interface CounterState {
  year: number;
  lastNumber: number;
}

export interface NextNumber {
  year: number;
  sequence: number;
  number: string;
  /** New counter value to persist for (kind, year). */
  counter: CounterState;
}

/**
 * Numbering policy: the sequence restarts at 1 each calendar year of the *issue date*, is strictly
 * `last + 1` (gap-free) and is never reused. The caller must hold a row lock on the counter for
 * (kind, year) while it persists `next.counter`; this function is pure.
 */
export function nextDocumentNumber(
  kind: DocumentKind,
  issueDate: IsoDate,
  counter: CounterState | null,
): NextNumber {
  const year = yearOf(issueDate);
  const last = counter && counter.year === year ? counter.lastNumber : 0;
  const sequence = last + 1;
  return {
    year,
    sequence,
    number: formatDocumentNumber(kind, year, sequence),
    counter: { year, lastNumber: sequence },
  };
}

export function nextInvoiceNumber(issueDate: IsoDate, counter: CounterState | null): NextNumber {
  return nextDocumentNumber('invoice', issueDate, counter);
}

/**
 * Checks a list of numbers for one year is gap-free and starts at 1 (audit helper).
 * Returns the missing sequences.
 */
export function findNumberingGaps(numbers: string[], kind: DocumentKind, year: number): number[] {
  const seqs = numbers
    .map(parseDocumentNumber)
    .filter((p): p is ParsedNumber => !!p && p.kind === kind && p.year === year)
    .map((p) => p.sequence)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  let expected = 1;
  for (const s of seqs) {
    while (expected < s) gaps.push(expected++);
    expected = s + 1;
  }
  return gaps;
}

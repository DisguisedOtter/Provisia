import { z } from 'zod';
import { currencyCodeSchema, minorUnitsSchema } from './common.js';

/**
 * Money is an integer amount in minor units (cents) plus a 3-letter ISO currency.
 * JS numbers are exact up to 2^53, far beyond any realistic invoice total.
 */
export const moneySchema = z.object({
  amount: minorUnitsSchema,
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

export function money(amount: number, currency = 'EUR'): Money {
  if (!Number.isSafeInteger(amount))
    throw new TypeError(`money amount must be an integer, got ${amount}`);
  return { amount, currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

/** Round half away from zero to an integer (the "half-up" used in EU invoicing). */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

/** Multiply by a factor (quantity, percentage/100, proration ratio) and round half-up. */
export function multiplyMoney(m: Money, factor: number): Money {
  return { amount: roundHalfUp(m.amount * factor), currency: m.currency };
}

/** Tax amount for a net amount at `ratePercent` (e.g. 21), rounded half-up. */
export function taxOn(net: Money, ratePercent: number): Money {
  return multiplyMoney(net, ratePercent / 100);
}

export function sumMoney(items: Money[], currency = 'EUR'): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}

/** Decimal places for a currency; everything we support uses 2. */
export function minorUnitDigits(_currency: string): number {
  return 2;
}

/** Converts `"12.34"` or `12.34` to minor units with half-up rounding. For user input only. */
export function parseMoney(input: string | number, currency = 'EUR'): Money {
  const n = typeof input === 'number' ? input : Number.parseFloat(input.replace(',', '.'));
  if (!Number.isFinite(n)) throw new TypeError(`invalid money input: ${input}`);
  return { amount: roundHalfUp(n * 10 ** minorUnitDigits(currency)), currency };
}

/** `€12.34` style formatting via Intl. */
export function formatMoney(m: Money, locale = 'nl-NL'): string {
  const digits = minorUnitDigits(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m.amount / 10 ** digits);
}

/** `12.34` as a plain decimal string (for CSV, PDFs, APIs that want decimals). */
export function toDecimalString(m: Money): string {
  const digits = minorUnitDigits(m.currency);
  const sign = m.amount < 0 ? '-' : '';
  const abs = Math.abs(m.amount);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = String(abs % 10 ** digits).padStart(digits, '0');
  return `${sign}${whole}.${frac}`;
}

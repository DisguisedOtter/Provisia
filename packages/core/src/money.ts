import { type Money, money, roundHalfUp } from '@provisia/shared';

export {
  addMoney,
  assertSameCurrency,
  formatMoney,
  type Money,
  money,
  multiplyMoney,
  parseMoney,
  roundHalfUp,
  subtractMoney,
  sumMoney,
  taxOn,
  toDecimalString,
} from '@provisia/shared';

/** `"21.00"` / `"21"` / `21` → 2100 basis points (exact integer, no float drift). */
export function percentToBasisPoints(rate: string | number): number {
  const str = typeof rate === 'number' ? rate.toFixed(2) : rate.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(str);
  if (!m) throw new TypeError(`invalid percentage: ${rate}`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(2, '0');
  return sign * (whole * 100 + Number(frac));
}

/** 2100 → `"21.00"` */
export function basisPointsToPercent(bp: number): string {
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Normalizes a percent string/number to the canonical `"21.00"` DTO form. */
export function normalizePercent(rate: string | number): string {
  return basisPointsToPercent(percentToBasisPoints(rate));
}

/** Exact tax numerator in 1/10000 cents: `amount * bp`. Divide by 10 000 and round once per group. */
export function taxNumerator(amountMinor: number, basisPoints: number): number {
  return amountMinor * basisPoints;
}

export function roundTaxNumerator(numerator: number): number {
  return roundHalfUp(numerator / 10_000);
}

/** Percentage of an amount, half-up (`percentOf(10000, "1.50")` → 150). */
export function percentOf(amountMinor: number, rate: string | number): number {
  return roundTaxNumerator(taxNumerator(amountMinor, percentToBasisPoints(rate)));
}

/**
 * Splits `total` across `weights` proportionally without losing cents (largest-remainder method).
 * `allocate(100, [1, 1, 1])` → `[34, 33, 33]`.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new TypeError('allocate: total must be an integer');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const even = Math.trunc(total / weights.length);
    const out = weights.map(() => even);
    out[0] = (out[0] ?? 0) + (total - even * weights.length);
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floors;
}

export function zero(currency = 'EUR'): Money {
  return money(0, currency);
}

export function negate(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function minMoney(a: Money, b: Money): Money {
  return a.amount <= b.amount ? a : b;
}

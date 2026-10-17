import type { BillingCycle, ProductPrice } from '@provisia/shared';
import { BILLING_CYCLE_MONTHS } from '@provisia/shared';

/** Cheapest effective monthly price across cycles, for "from €x / mo" labels. */
export function fromPrice(
  prices: ProductPrice[],
): { perMonth: number; price: ProductPrice } | null {
  let best: { perMonth: number; price: ProductPrice } | null = null;
  for (const p of prices) {
    const months = BILLING_CYCLE_MONTHS[p.billingCycle] || 1;
    const perMonth = p.recurring / months;
    if (!best || perMonth < best.perMonth) best = { perMonth, price: p };
  }
  return best;
}

export const CYCLE_ORDER: BillingCycle[] = [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
  'onetime',
];

export function sortPrices(prices: ProductPrice[]): ProductPrice[] {
  return [...prices].sort(
    (a, b) => CYCLE_ORDER.indexOf(a.billingCycle) - CYCLE_ORDER.indexOf(b.billingCycle),
  );
}

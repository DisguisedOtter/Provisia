import type { BillingCycle } from '@provisia/shared';
import { roundHalfUp } from '@provisia/shared';
import { isRecurring, periodEndingAt } from './cycles.js';
import { daysBetween, type IsoDate } from './dates.js';

export interface ProrationInput {
  /** Day the change takes effect (inclusive). */
  changeDate: IsoDate;
  /** Current next due date of the service (end of the paid period, exclusive). */
  nextDueDate: IsoDate;
  /** Cycle of the current (old) plan; defines the paid period. */
  billingCycle: BillingCycle;
  /** Per-cycle recurring price of the current plan. */
  oldAmount: number;
  /** Per-cycle recurring price of the new plan, expressed for the same cycle length. */
  newAmount: number;
  /** Day-of-month anchor of the subscription (registration day); keeps month-end periods exact. */
  anchorDay?: number;
  currency?: string;
}

export interface ProrationResult {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  daysInPeriod: number;
  /** Days from changeDate up to (not including) nextDueDate, clamped to [0, daysInPeriod]. */
  daysRemaining: number;
  /** Unused value of the old plan for the remaining days (>= 0). */
  credit: number;
  /** Value of the new plan for the remaining days (>= 0). */
  charge: number;
  /** charge - credit: positive → invoice this; negative → credit the client. */
  net: number;
  currency: string;
  /** Exact ratio used (daysRemaining / daysInPeriod). */
  ratio: number;
}

/**
 * Proration for an upgrade/downgrade effective `changeDate`, settling up to the next due date.
 * Day-based on the actual period length (28–31 days for monthly, 365/366 for annual), half-up rounding,
 * credit and charge rounded independently so both appear as clean lines on the invoice.
 */
export function prorate(input: ProrationInput): ProrationResult {
  const currency = input.currency ?? 'EUR';
  if (!isRecurring(input.billingCycle)) {
    return {
      periodStart: input.changeDate,
      periodEnd: input.changeDate,
      daysInPeriod: 0,
      daysRemaining: 0,
      credit: 0,
      charge: 0,
      net: 0,
      currency,
      ratio: 0,
    };
  }
  const period = periodEndingAt(input.nextDueDate, input.billingCycle, input.anchorDay);
  const remainingRaw = daysBetween(input.changeDate, input.nextDueDate);
  const daysRemaining = Math.min(Math.max(remainingRaw, 0), period.days);
  const ratio = period.days === 0 ? 0 : daysRemaining / period.days;
  const credit = roundHalfUp(input.oldAmount * ratio);
  const charge = roundHalfUp(input.newAmount * ratio);
  return {
    periodStart: period.start,
    periodEnd: period.end,
    daysInPeriod: period.days,
    daysRemaining,
    credit,
    charge,
    net: charge - credit,
    currency,
    ratio,
  };
}

/**
 * Converts a price quoted for `fromCycle` to the equivalent for `toCycle` (linear by months), for
 * prorating a plan change that also changes the cycle. Returns the input unchanged for equal cycles.
 */
export function convertCycleAmount(
  amount: number,
  fromCycle: BillingCycle,
  toCycle: BillingCycle,
): number {
  if (fromCycle === toCycle) return amount;
  if (!isRecurring(fromCycle) || !isRecurring(toCycle)) {
    throw new RangeError('cannot convert onetime prices between cycles');
  }
  const from = periodMonths(fromCycle);
  const to = periodMonths(toCycle);
  return roundHalfUp((amount * to) / from);
}

function periodMonths(cycle: BillingCycle): number {
  return {
    monthly: 1,
    quarterly: 3,
    semiannually: 6,
    annually: 12,
    biennially: 24,
    triennially: 36,
    onetime: 0,
  }[cycle];
}

export interface ProrationLines {
  /** Negative-amount line reversing the unused part of the old plan; null when 0. */
  creditLine: {
    description: string;
    unitAmount: number;
    periodStart: IsoDate;
    periodEnd: IsoDate;
  } | null;
  /** Positive line charging the new plan for the rest of the period; null when 0. */
  chargeLine: {
    description: string;
    unitAmount: number;
    periodStart: IsoDate;
    periodEnd: IsoDate;
  } | null;
}

/** Turns a proration into invoice lines (descriptions in the client's language, en/nl). */
export function prorationLines(
  p: ProrationResult,
  names: { oldPlan: string; newPlan: string },
  language = 'en',
  changeDate: IsoDate,
): ProrationLines {
  const nl = language.toLowerCase().startsWith('nl');
  const range = `${changeDate} – ${p.periodEnd}`;
  return {
    creditLine:
      p.credit > 0
        ? {
            description: nl
              ? `Creditering ongebruikte periode ${names.oldPlan} (${range}, ${p.daysRemaining}/${p.daysInPeriod} dagen)`
              : `Credit for unused period ${names.oldPlan} (${range}, ${p.daysRemaining}/${p.daysInPeriod} days)`,
            unitAmount: -p.credit,
            periodStart: changeDate,
            periodEnd: p.periodEnd,
          }
        : null,
    chargeLine:
      p.charge > 0
        ? {
            description: nl
              ? `${names.newPlan} pro rata (${range}, ${p.daysRemaining}/${p.daysInPeriod} dagen)`
              : `${names.newPlan} pro rata (${range}, ${p.daysRemaining}/${p.daysInPeriod} days)`,
            unitAmount: p.charge,
            periodStart: changeDate,
            periodEnd: p.periodEnd,
          }
        : null,
  };
}

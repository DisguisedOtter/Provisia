import { BILLING_CYCLE_MONTHS, type BillingCycle } from '@provisia/shared';
import { addDays, addMonths, daysBetween, type IsoDate, parseIsoDate } from './dates.js';

export function cycleMonths(cycle: BillingCycle): number {
  return BILLING_CYCLE_MONTHS[cycle];
}

export function isRecurring(cycle: BillingCycle): boolean {
  return cycleMonths(cycle) > 0;
}

/**
 * Next due date after `current` for a cycle. `anchorDay` (default: day of `current`) keeps month-end
 * subscriptions from drifting; pass the registration day when progressing a service.
 */
export function nextDueDate(current: IsoDate, cycle: BillingCycle, anchorDay?: number): IsoDate {
  const months = cycleMonths(cycle);
  if (months === 0) throw new RangeError('onetime services have no next due date');
  return addMonths(current, months, anchorDay ?? parseIsoDate(current).day);
}

/** Start of the period that ends (exclusive) at `nextDue`. */
export function previousDueDate(
  nextDue: IsoDate,
  cycle: BillingCycle,
  anchorDay?: number,
): IsoDate {
  const months = cycleMonths(cycle);
  if (months === 0) throw new RangeError('onetime services have no billing period');
  return addMonths(nextDue, -months, anchorDay ?? parseIsoDate(nextDue).day);
}

export interface BillingPeriod {
  /** First day covered (inclusive). */
  start: IsoDate;
  /** Last day covered (inclusive) — the day before the following due date. */
  end: IsoDate;
  /** Exclusive end; equals the following due date. */
  nextDue: IsoDate;
  days: number;
}

/** The period an invoice for `dueDate` covers: `[dueDate, dueDate + cycle)`. */
export function periodStartingAt(
  dueDate: IsoDate,
  cycle: BillingCycle,
  anchorDay?: number,
): BillingPeriod {
  const next = nextDueDate(dueDate, cycle, anchorDay);
  return {
    start: dueDate,
    end: addDays(next, -1),
    nextDue: next,
    days: daysBetween(dueDate, next),
  };
}

/** The period currently running when the service's next due date is `nextDue`. */
export function periodEndingAt(
  nextDue: IsoDate,
  cycle: BillingCycle,
  anchorDay?: number,
): BillingPeriod {
  const start = previousDueDate(nextDue, cycle, anchorDay);
  return { start, end: addDays(nextDue, -1), nextDue, days: daysBetween(start, nextDue) };
}

/** Domain periods are whole years from the current expiry. */
export function domainPeriodStartingAt(dueDate: IsoDate, years: number): BillingPeriod {
  const next = addMonths(dueDate, years * 12);
  return {
    start: dueDate,
    end: addDays(next, -1),
    nextDue: next,
    days: daysBetween(dueDate, next),
  };
}

/** Monthly-equivalent price of a cycle amount (for comparing plans); 0 for onetime. */
export function monthlyEquivalent(amount: number, cycle: BillingCycle): number {
  const months = cycleMonths(cycle);
  return months === 0 ? 0 : amount / months;
}

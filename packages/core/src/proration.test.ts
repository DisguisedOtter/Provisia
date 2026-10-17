import { describe, expect, it } from 'vitest';
import { convertCycleAmount, prorate, prorationLines } from './proration.js';

describe('proration', () => {
  it('upgrade mid-month charges the difference for the remaining days', () => {
    // Period 2026-02-01 .. 2026-02-28 (28 days). Change on Feb 15 -> 14 days left.
    const p = prorate({
      changeDate: '2026-02-15',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 1000,
      newAmount: 3000,
    });
    expect(p).toMatchObject({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      daysInPeriod: 28,
      daysRemaining: 14,
    });
    expect(p.credit).toBe(500);
    expect(p.charge).toBe(1500);
    expect(p.net).toBe(1000);
  });
  it('downgrade yields a negative net (credit)', () => {
    const p = prorate({
      changeDate: '2026-02-15',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 3000,
      newAmount: 1000,
    });
    expect(p.net).toBe(-1000);
  });
  it('rounds half up per side', () => {
    // 31-day period, 10 days left: 999 * 10/31 = 322.26 -> 322 ; 1001 * 10/31 = 322.9 -> 323
    const p = prorate({
      changeDate: '2026-01-22',
      nextDueDate: '2026-02-01',
      billingCycle: 'monthly',
      oldAmount: 999,
      newAmount: 1001,
    });
    expect(p.daysInPeriod).toBe(31);
    expect(p.daysRemaining).toBe(10);
    expect(p.credit).toBe(322);
    expect(p.charge).toBe(323);
  });
  it('works for every cycle length including leap years', () => {
    const annual = prorate({
      changeDate: '2024-07-01',
      nextDueDate: '2025-01-01',
      billingCycle: 'annually',
      oldAmount: 36600,
      newAmount: 0,
    });
    expect(annual.daysInPeriod).toBe(366);
    expect(annual.daysRemaining).toBe(184);
    expect(annual.credit).toBe(18400);

    const quarterly = prorate({
      changeDate: '2026-05-01',
      nextDueDate: '2026-07-01',
      billingCycle: 'quarterly',
      oldAmount: 9100,
      newAmount: 9100,
    });
    expect(quarterly.daysInPeriod).toBe(91);
    expect(quarterly.net).toBe(0);

    const tri = prorate({
      changeDate: '2027-01-01',
      nextDueDate: '2029-01-01',
      billingCycle: 'triennially',
      oldAmount: 0,
      newAmount: 109600,
    });
    expect(tri.daysInPeriod).toBe(1096);
    expect(tri.charge).toBe(73100);
  });
  it('clamps: change on/after due date is zero, change before period start is full', () => {
    const after = prorate({
      changeDate: '2026-03-01',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 1000,
      newAmount: 2000,
    });
    expect(after.daysRemaining).toBe(0);
    expect(after.net).toBe(0);
    const before = prorate({
      changeDate: '2025-12-01',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 1000,
      newAmount: 2000,
    });
    expect(before.daysRemaining).toBe(before.daysInPeriod);
    expect(before.net).toBe(1000);
  });
  it('onetime has no proration', () => {
    const p = prorate({
      changeDate: '2026-02-15',
      nextDueDate: '2026-03-01',
      billingCycle: 'onetime',
      oldAmount: 1000,
      newAmount: 3000,
    });
    expect(p.net).toBe(0);
    expect(p.daysInPeriod).toBe(0);
  });
  it('respects the anchor day for month-end subscriptions', () => {
    // Anchored on the 31st: period Jan 31 .. Feb 27, next due Feb 28.
    const p = prorate({
      changeDate: '2026-02-14',
      nextDueDate: '2026-02-28',
      billingCycle: 'monthly',
      oldAmount: 2800,
      newAmount: 0,
      anchorDay: 31,
    });
    expect(p.periodStart).toBe('2026-01-31');
    expect(p.daysInPeriod).toBe(28);
    expect(p.credit).toBe(1400);
  });
  it('converts amounts between cycles', () => {
    expect(convertCycleAmount(1200, 'annually', 'monthly')).toBe(100);
    expect(convertCycleAmount(1000, 'monthly', 'quarterly')).toBe(3000);
    expect(convertCycleAmount(999, 'annually', 'monthly')).toBe(83); // 83.25
    expect(() => convertCycleAmount(1, 'onetime', 'monthly')).toThrow(RangeError);
  });
  it('produces invoice lines in the client language', () => {
    const p = prorate({
      changeDate: '2026-02-15',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 1000,
      newAmount: 3000,
    });
    const lines = prorationLines(p, { oldPlan: 'Starter', newPlan: 'Pro' }, 'nl', '2026-02-15');
    expect(lines.creditLine?.unitAmount).toBe(-500);
    expect(lines.creditLine?.description).toMatch(/Creditering/);
    expect(lines.chargeLine?.unitAmount).toBe(1500);
    expect(lines.chargeLine?.description).toMatch(/Pro pro rata/);
    const none = prorate({
      changeDate: '2026-03-01',
      nextDueDate: '2026-03-01',
      billingCycle: 'monthly',
      oldAmount: 1,
      newAmount: 1,
    });
    expect(prorationLines(none, { oldPlan: 'a', newPlan: 'b' }, 'en', '2026-03-01')).toEqual({
      creditLine: null,
      chargeLine: null,
    });
  });
});

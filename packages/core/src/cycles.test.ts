import { describe, expect, it } from 'vitest';
import {
  domainPeriodStartingAt,
  nextDueDate,
  periodEndingAt,
  periodStartingAt,
  previousDueDate,
} from './cycles.js';

describe('billing cycles', () => {
  it('progresses every cycle', () => {
    expect(nextDueDate('2026-01-15', 'monthly')).toBe('2026-02-15');
    expect(nextDueDate('2026-01-15', 'quarterly')).toBe('2026-04-15');
    expect(nextDueDate('2026-01-15', 'semiannually')).toBe('2026-07-15');
    expect(nextDueDate('2026-01-15', 'annually')).toBe('2027-01-15');
    expect(nextDueDate('2026-01-15', 'biennially')).toBe('2028-01-15');
    expect(nextDueDate('2026-01-15', 'triennially')).toBe('2029-01-15');
    expect(() => nextDueDate('2026-01-15', 'onetime')).toThrow(RangeError);
  });
  it('handles month ends without drifting when an anchor is given', () => {
    let d = '2026-01-31';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      d = nextDueDate(d, 'monthly', 31);
      seen.push(d);
    }
    expect(seen).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    // Without an anchor the day drifts to the 28th and stays there.
    expect(nextDueDate(nextDueDate('2026-01-31', 'monthly'), 'monthly')).toBe('2026-03-28');
  });
  it('computes periods in both directions', () => {
    expect(periodStartingAt('2026-02-01', 'monthly')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
      nextDue: '2026-03-01',
      days: 28,
    });
    expect(periodEndingAt('2026-03-01', 'monthly')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
      nextDue: '2026-03-01',
      days: 28,
    });
    expect(previousDueDate('2026-03-31', 'monthly')).toBe('2026-02-28');
    expect(periodEndingAt('2027-01-01', 'annually').days).toBe(365);
    expect(periodEndingAt('2025-01-01', 'annually').days).toBe(366);
  });
  it('domain periods are whole years', () => {
    expect(domainPeriodStartingAt('2026-02-29'.replace('29', '28'), 2)).toEqual({
      start: '2026-02-28',
      end: '2028-02-27',
      nextDue: '2028-02-28',
      days: 730,
    });
  });
});

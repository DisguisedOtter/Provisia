import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isLeapYear,
  parseIsoDate,
  toIsoDate,
} from './dates.js';

describe('dates', () => {
  it('parses and rejects invalid dates', () => {
    expect(parseIsoDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(() => parseIsoDate('2026-02-30')).toThrow();
    expect(() => parseIsoDate('2026-13-01')).toThrow();
    expect(() => parseIsoDate('26-1-1')).toThrow();
  });
  it('knows leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
  it('clamps month-end and restores the anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-01-31', 12)).toBe('2027-01-31');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('formats Date in UTC', () => {
    expect(toIsoDate(new Date('2026-10-17T23:30:00Z'))).toBe('2026-10-17');
  });
});

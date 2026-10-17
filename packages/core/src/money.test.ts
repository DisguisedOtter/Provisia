import { describe, expect, it } from 'vitest';
import {
  allocate,
  basisPointsToPercent,
  normalizePercent,
  percentOf,
  percentToBasisPoints,
} from './money.js';

describe('money extras', () => {
  it('converts percentages exactly', () => {
    expect(percentToBasisPoints('21.00')).toBe(2100);
    expect(percentToBasisPoints('21')).toBe(2100);
    expect(percentToBasisPoints('25.5')).toBe(2550);
    expect(percentToBasisPoints(19)).toBe(1900);
    expect(percentToBasisPoints(0.07)).toBe(7);
    expect(basisPointsToPercent(2550)).toBe('25.50');
    expect(normalizePercent('9')).toBe('9.00');
    expect(() => percentToBasisPoints('21.123')).toThrow();
  });
  it('percentOf rounds half up', () => {
    expect(percentOf(499, '21.00')).toBe(105); // 104.79
    expect(percentOf(50, '1.00')).toBe(1); // 0.5 -> 1
    expect(percentOf(-50, '1.00')).toBe(-1);
    expect(percentOf(10000, '1.50')).toBe(150);
  });
  it('allocates without losing cents', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(5, [3, 1, 1])).toEqual([3, 1, 1]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([4, 3]);
    const parts = allocate(123457, [7, 13, 29, 31]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(123457);
  });
});

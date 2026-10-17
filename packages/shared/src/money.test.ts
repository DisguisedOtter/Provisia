import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  money,
  multiplyMoney,
  parseMoney,
  roundHalfUp,
  taxOn,
  toDecimalString,
} from './money.js';

describe('money', () => {
  it('rounds half up away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
  it('computes tax in cents', () => {
    expect(taxOn(money(499), 21)).toEqual(money(105)); // 104.79 -> 105
    expect(multiplyMoney(money(1000), 0.5)).toEqual(money(500));
  });
  it('parses and formats', () => {
    expect(parseMoney('12,34')).toEqual(money(1234));
    expect(toDecimalString(money(-1205))).toBe('-12.05');
    expect(formatMoney(money(1234), 'en-US')).toBe('€12.34');
  });
});

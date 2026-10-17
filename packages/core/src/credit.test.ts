import { describe, expect, it } from 'vitest';
import { allocatePayment, applyCredit, paidAmount } from './credit.js';

describe('credit', () => {
  it('applies partial, full and zero credit', () => {
    expect(applyCredit(1000, 300)).toEqual({
      applied: 300,
      remainingDue: 700,
      remainingBalance: 0,
    });
    expect(applyCredit(1000, 5000)).toEqual({
      applied: 1000,
      remainingDue: 0,
      remainingBalance: 4000,
    });
    expect(applyCredit(1000, 0)).toEqual({ applied: 0, remainingDue: 1000, remainingBalance: 0 });
    expect(applyCredit(0, 500)).toEqual({ applied: 0, remainingDue: 0, remainingBalance: 500 });
    expect(applyCredit(-100, 500).applied).toBe(0);
    expect(() => applyCredit(1.5, 1)).toThrow();
  });
  it('allocates payments and overpayments', () => {
    expect(allocatePayment(1000, 1000)).toEqual({
      applied: 1000,
      overpayment: 0,
      remainingDue: 0,
      settled: true,
    });
    expect(allocatePayment(400, 1000)).toEqual({
      applied: 400,
      overpayment: 0,
      remainingDue: 600,
      settled: false,
    });
    expect(allocatePayment(1500, 1000)).toEqual({
      applied: 1000,
      overpayment: 500,
      remainingDue: 0,
      settled: true,
    });
    expect(allocatePayment(100, 0)).toEqual({
      applied: 0,
      overpayment: 100,
      remainingDue: 0,
      settled: true,
    });
    expect(() => allocatePayment(-1, 100)).toThrow(RangeError);
  });
  it('sums payments minus refunds', () => {
    expect(
      paidAmount([
        { type: 'payment', amount: 1000 },
        { type: 'credit', amount: 200 },
        { type: 'refund', amount: -300 },
        { type: 'refund', amount: 100 },
      ]),
    ).toBe(800);
  });
});

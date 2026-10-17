export interface CreditApplication {
  /** Credit taken from the balance and applied to the invoice. */
  applied: number;
  /** Amount still due on the invoice after credit. */
  remainingDue: number;
  /** Client balance after application. */
  remainingBalance: number;
}

/** Applies as much credit as available (never more than the amount due, never below zero balance). */
export function applyCredit(amountDue: number, creditBalance: number): CreditApplication {
  if (!Number.isSafeInteger(amountDue) || !Number.isSafeInteger(creditBalance)) {
    throw new TypeError('applyCredit expects integer minor units');
  }
  const applied = Math.max(0, Math.min(amountDue, creditBalance));
  return { applied, remainingDue: amountDue - applied, remainingBalance: creditBalance - applied };
}

export interface PaymentAllocation {
  /** Part of the payment that settles the invoice. */
  applied: number;
  /** Part exceeding the open amount → goes to the credit balance. */
  overpayment: number;
  /** Open amount after the payment. */
  remainingDue: number;
  settled: boolean;
}

/** Allocates a payment to an invoice's open amount; the excess becomes credit (ARCHITECTURE §5). */
export function allocatePayment(paymentAmount: number, openAmount: number): PaymentAllocation {
  if (!Number.isSafeInteger(paymentAmount) || !Number.isSafeInteger(openAmount)) {
    throw new TypeError('allocatePayment expects integer minor units');
  }
  if (paymentAmount < 0) throw new RangeError('payment must be positive');
  const applied = Math.min(paymentAmount, Math.max(openAmount, 0));
  const remainingDue = Math.max(openAmount, 0) - applied;
  return {
    applied,
    overpayment: paymentAmount - applied,
    remainingDue,
    settled: remainingDue === 0,
  };
}

/** Sum of payment-type transactions minus refunds, for one invoice. */
export function paidAmount(
  transactions: Array<{ type: 'payment' | 'refund' | 'credit'; amount: number }>,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.type === 'payment' || t.type === 'credit') sum += t.amount;
    else if (t.type === 'refund') sum -= Math.abs(t.amount);
  }
  return sum;
}

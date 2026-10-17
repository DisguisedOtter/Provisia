/**
 * @provisia/core — pure domain logic, no IO.
 * Owner: billing agent. This stub only re-exports the money primitives; tax, proration,
 * invoice numbering and dunning rules are added here as separate files.
 */
export const VERSION = '0.1.0';

export {
  addMoney,
  formatMoney,
  money,
  multiplyMoney,
  parseMoney,
  roundHalfUp,
  subtractMoney,
  sumMoney,
  taxOn,
  toDecimalString,
} from '@provisia/shared';
export type { Money } from '@provisia/shared';

/**
 * @provisia/core — pure domain logic, no IO.
 * Owner: billing agent. Persistence adapters live under `@provisia/core/db`, the invoice PDF under
 * `@provisia/core/pdf`; this entry point stays free of Node/DB imports so it is unit-testable in isolation.
 */
export const VERSION = '0.1.0';

export * from './credit.js';
export * from './cycles.js';
export * from './dates.js';
export * from './dunning.js';
export * from './invoice.js';
export * from './money.js';
export * from './numbering.js';
export * from './proration.js';
export * from './tax.js';
export * from './vies/index.js';

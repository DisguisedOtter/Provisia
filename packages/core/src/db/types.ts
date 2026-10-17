import type { Db } from '@provisia/db';

/** A Drizzle transaction handle (`db.transaction(async (tx) => ...)`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything we can run queries on: the root db or a transaction (nested calls become savepoints). */
export type Executor = Db | Tx;

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 409,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export const notFoundError = (entity: string) =>
  new BillingError('not_found', `${entity} not found`, 404);

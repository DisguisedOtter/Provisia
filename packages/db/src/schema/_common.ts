import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid.js';

/** uuid v7 primary key generated app-side. */
export const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

/** Money: integer minor units (cents). Read back as a JS number. */
export const money = (name: string) => bigint(name, { mode: 'number' });
export const currency = () => char('currency', { length: 3 }).notNull().default('EUR');

import { settings } from '@provisia/db';
import { parseSettings, type Settings } from '@provisia/shared';
import type { Executor } from './types.js';

/** Flat typed settings with defaults (`s['billing.paymentTermDays']`). One query. */
export async function loadSettings(db: Executor): Promise<Settings> {
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);
  return parseSettings(rows);
}

import { clients } from '@provisia/db';
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { isEuCountry } from '../tax.js';
import {
  parseVatNumber,
  type ViesCheckResult,
  type ViesClient,
  ViesUnavailableError,
} from '../vies/index.js';
import type { Executor } from './types.js';
import { notFoundError } from './types.js';

export interface VatValidation {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  requestIdentifier: string | null;
  checkedAt: Date;
  /** Served from the cache on the client row. */
  cached: boolean;
  /** VIES unreachable: `valid` is the previous cached state. */
  unavailable: boolean;
  /** Set when the number could not even be parsed as an EU VAT id. */
  reason?: 'unparseable' | 'non_eu' | 'no_vat_number';
}

export interface ValidateOptions {
  now?: Date;
  /** Re-check even when a recent result is cached. */
  force?: boolean;
  /** Cache lifetime; defaults to 90 days (`tax.viesCacheDays`). */
  cacheDays?: number;
}

function fromCache(
  client: typeof clients.$inferSelect,
  now: Date,
  unavailable: boolean,
): VatValidation {
  const r = (client.vatCheckResult ?? {}) as Partial<ViesCheckResult> & {
    countryCode?: string;
    vatNumber?: string;
  };
  return {
    valid: client.vatValidated,
    countryCode: r.countryCode ?? client.country,
    vatNumber: r.vatNumber ?? client.vatNumber ?? '',
    name: r.name ?? null,
    address: r.address ?? null,
    requestIdentifier: r.requestIdentifier ?? null,
    checkedAt: client.vatCheckedAt ?? now,
    cached: true,
    unavailable,
  };
}

/**
 * Validates a client's VAT number against VIES and caches the outcome on the client row
 * (`vat_validated`, `vat_validated_at`, `vat_checked_at`, `vat_check_result`). An outage never flips a
 * previously valid number to invalid.
 */
export async function validateClientVat(
  db: Executor,
  clientId: string,
  vies: ViesClient,
  opts: ValidateOptions = {},
): Promise<VatValidation> {
  const now = opts.now ?? new Date();
  const cacheDays = opts.cacheDays ?? 90;
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw notFoundError('Client');

  const raw = client.vatNumber?.trim() ?? '';
  const invalidate = async (reason: VatValidation['reason']): Promise<VatValidation> => {
    await db
      .update(clients)
      .set({
        vatValidated: false,
        vatValidatedAt: null,
        vatCheckedAt: now,
        vatCheckResult: { valid: false, reason, checkedAt: now.toISOString() },
      })
      .where(eq(clients.id, clientId));
    return {
      valid: false,
      countryCode: client.country,
      vatNumber: raw,
      name: null,
      address: null,
      requestIdentifier: null,
      checkedAt: now,
      cached: false,
      unavailable: false,
      reason,
    };
  };
  if (!raw) return invalidate('no_vat_number');
  const parsed = parseVatNumber(raw, client.country);
  if (!parsed) return invalidate(isEuCountry(client.country) ? 'unparseable' : 'non_eu');

  if (
    !opts.force &&
    client.vatCheckedAt &&
    now.getTime() - client.vatCheckedAt.getTime() < cacheDays * 86_400_000
  ) {
    return fromCache(client, now, false);
  }

  let result: ViesCheckResult;
  try {
    result = await vies.checkVat(parsed.countryCode, parsed.number);
  } catch (err) {
    if (err instanceof ViesUnavailableError) return fromCache(client, now, true);
    throw err;
  }
  await db
    .update(clients)
    .set({
      vatValidated: result.valid,
      vatValidatedAt: result.valid ? now : null,
      vatCheckedAt: now,
      vatCheckResult: { ...result, checkedAt: result.checkedAt.toISOString() },
      // Normalize what the user typed so the invoice shows the canonical id.
      vatNumber: parsed.normalized,
    })
    .where(eq(clients.id, clientId));
  return { ...result, checkedAt: now, cached: false, unavailable: false };
}

export interface RevalidateResult {
  checked: number;
  changed: Array<{ clientId: string; from: boolean; to: boolean }>;
  unavailable: number;
}

/** Monthly re-check of every client with a VAT number whose last check is older than `olderThanDays`. */
export async function revalidateVatNumbers(
  db: Executor,
  vies: ViesClient,
  opts: { now?: Date; olderThanDays?: number; limit?: number } = {},
): Promise<RevalidateResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.olderThanDays ?? 30) * 86_400_000);
  const rows = await db
    .select({ id: clients.id, vatValidated: clients.vatValidated })
    .from(clients)
    .where(
      and(
        isNotNull(clients.vatNumber),
        ne(clients.vatNumber, ''),
        ne(clients.status, 'closed'),
        or(isNull(clients.vatCheckedAt), lt(clients.vatCheckedAt, cutoff)),
      ),
    )
    .orderBy(sql`${clients.vatCheckedAt} asc nulls first`)
    .limit(opts.limit ?? 500);
  const result: RevalidateResult = { checked: 0, changed: [], unavailable: 0 };
  for (const row of rows) {
    const v = await validateClientVat(db, row.id, vies, { now, force: true });
    result.checked += 1;
    if (v.unavailable) result.unavailable += 1;
    else if (v.valid !== row.vatValidated)
      result.changed.push({ clientId: row.id, from: row.vatValidated, to: v.valid });
  }
  return result;
}

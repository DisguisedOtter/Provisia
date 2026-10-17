import { type Db, settings as settingsTable } from '@provisia/db';
import { decrypt, encrypt, isEncrypted } from '@provisia/module-sdk';
import {
  parseSettings,
  parseSettingsGroup,
  SECRET_MASK,
  SECRET_SETTING_KEYS,
  type Settings,
  type SettingsGroup,
  type SettingsGroupName,
  settingsGroups,
} from '@provisia/shared';
import { eq, inArray, like } from 'drizzle-orm';

/**
 * Cached, typed access to the settings table for API and worker code.
 *
 *   const billing = await getSettings(db, 'billing');   // { paymentTermDays: 14, ... }
 *   const all = await getAllSettings(db);                // flat: all['billing.paymentTermDays']
 *
 * Secrets (`SECRET_SETTING_KEYS`) are decrypted here, so never log or return the result of these helpers
 * directly; the admin API masks them (`maskSecrets`). Cache: in-process, `CACHE_TTL_MS`, invalidated on
 * every write made through `saveSettingsGroup()` in this process. Other processes (the worker) pick up
 * changes within the TTL.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const groupCache = new Map<string, CacheEntry<unknown>>();
let allCache: CacheEntry<Settings> | undefined;

function decryptRow(row: { key: string; value: unknown }) {
  if (SECRET_SETTING_KEYS.has(row.key) && isEncrypted(row.value)) {
    try {
      return { key: row.key, value: decrypt(row.value) };
    } catch {
      return { key: row.key, value: '' };
    }
  }
  return row;
}

export async function getSettings<G extends SettingsGroupName>(
  db: Db,
  group: G,
): Promise<SettingsGroup<G>> {
  const hit = groupCache.get(group);
  if (hit && hit.expiresAt > Date.now()) return hit.value as SettingsGroup<G>;
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(like(settingsTable.key, `${group}.%`));
  const value = parseSettingsGroup(group, rows.map(decryptRow));
  groupCache.set(group, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getAllSettings(db: Db): Promise<Settings> {
  if (allCache && allCache.expiresAt > Date.now()) return allCache.value;
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable);
  const value = parseSettings(rows.map(decryptRow));
  allCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateSettings(group?: SettingsGroupName): void {
  if (group) groupCache.delete(group);
  else groupCache.clear();
  allCache = undefined;
}

/** Replaces secret values with `SECRET_MASK` (empty secrets stay empty so the UI can tell "unset"). */
export function maskSecrets<G extends SettingsGroupName>(
  group: G,
  value: SettingsGroup<G>,
): SettingsGroup<G> {
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of Object.keys(out)) {
    if (SECRET_SETTING_KEYS.has(`${group}.${field}`) && out[field]) out[field] = SECRET_MASK;
  }
  return out as SettingsGroup<G>;
}

/**
 * Validates and upserts a partial group update. Secret fields equal to `SECRET_MASK` are left untouched;
 * other secret values are encrypted. Returns `{ before, after }` (masked) for the audit log.
 */
export async function saveSettingsGroup<G extends SettingsGroupName>(
  db: Db,
  group: G,
  patch: Partial<SettingsGroup<G>>,
): Promise<{ before: SettingsGroup<G>; after: SettingsGroup<G>; changedKeys: string[] }> {
  const before = await getSettings(db, group);
  const merged = settingsGroups[group].parse({ ...before, ...patch }) as SettingsGroup<G>;
  const changedKeys: string[] = [];
  const writes: Array<{ key: string; value: unknown }> = [];
  for (const field of Object.keys(patch) as Array<keyof SettingsGroup<G> & string>) {
    const flatKey = `${group}.${field}`;
    const isSecret = SECRET_SETTING_KEYS.has(flatKey);
    const next = merged[field];
    if (isSecret && next === SECRET_MASK) continue;
    if (JSON.stringify(next) === JSON.stringify(before[field])) continue;
    changedKeys.push(flatKey);
    writes.push({
      key: flatKey,
      value: isSecret && typeof next === 'string' && next !== '' ? encrypt(next) : next,
    });
  }
  if (writes.length > 0) {
    await db.transaction(async (tx) => {
      for (const w of writes) {
        await tx
          .insert(settingsTable)
          .values({ key: w.key, value: w.value })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: w.value } });
      }
    });
  }
  invalidateSettings(group);
  const after = await getSettings(db, group);
  return { before: maskSecrets(group, before), after: maskSecrets(group, after), changedKeys };
}

/** Deletes rows for keys that are no longer in the registry (used by the maintenance job). */
export async function pruneUnknownSettings(db: Db, knownKeys: string[]): Promise<number> {
  const rows = await db.select({ key: settingsTable.key }).from(settingsTable);
  const stale = rows.map((r) => r.key).filter((k) => !knownKeys.includes(k));
  if (stale.length === 0) return 0;
  await db.delete(settingsTable).where(inArray(settingsTable.key, stale));
  return stale.length;
}

/** Writes a single flat key; used by seeds/tests. */
export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  const stored =
    SECRET_SETTING_KEYS.has(key) && typeof value === 'string' && value ? encrypt(value) : value;
  await db
    .insert(settingsTable)
    .values({ key, value: stored })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: stored } });
  invalidateSettings();
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, key));
  invalidateSettings();
}

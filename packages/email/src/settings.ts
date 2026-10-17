import path from 'node:path';
import { type Db, settings as settingsTable } from '@provisia/db';
import { decrypt, isEncrypted } from '@provisia/module-sdk';
import { parseSettings, SECRET_SETTING_KEYS, type Settings } from '@provisia/shared';

/**
 * Loads the flat settings view with secrets decrypted (the settings module stores secret keys as
 * `enc:v1:...`). Not cached: callers are jobs and admin requests, both infrequent.
 */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable);
  const decrypted = rows.map((row) => {
    if (SECRET_SETTING_KEYS.has(row.key) && isEncrypted(row.value)) {
      try {
        return { key: row.key, value: decrypt(row.value) };
      } catch {
        return { key: row.key, value: '' };
      }
    }
    return row;
  });
  return parseSettings(decrypted);
}

/** Absolute root for uploaded files: `STORAGE_PATH` env, else `storage.localPath` setting, else `./storage`. */
export function resolveStoragePath(s?: Pick<Settings, 'storage.localPath'>): string {
  const configured = process.env.STORAGE_PATH || s?.['storage.localPath'] || 'storage';
  return path.resolve(configured);
}

/** Absolute URL helpers for links in emails. */
export function urls(env: { appUrl?: string; webUrl?: string } = {}) {
  const web = (env.webUrl ?? process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const app = (env.appUrl ?? process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return {
    web,
    app,
    adminTicket: (id: string) => `${web}/admin/tickets/${id}`,
    portalTicket: (id: string) => `${web}/portal/tickets/${id}`,
  };
}

import type { ModuleContext, RemoteOption, ServerDTO } from '@provisia/module-sdk';
import { SkrimeClient, SkrimeError } from '@provisia/registrar-skrime';
import { type SkrimeCredentials, skrimeCredentialsSchema } from './config.js';

export { SkrimeClient, SkrimeError } from '@provisia/registrar-skrime';

export class SkrimeProvisionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SkrimeProvisionError';
  }
}

/** Builds the API client from the server row's (decrypted) credentials. */
export function clientFor(ctx: ModuleContext<unknown>, server: ServerDTO | null): SkrimeClient {
  if (!server)
    throw new SkrimeProvisionError('no_server', 'Service has no Skrime account assigned');
  const creds = skrimeCredentialsSchema.parse(ctx.credentials) as SkrimeCredentials;
  return new SkrimeClient({
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    fetch: ctx.fetch,
    logger: ctx.logger,
    timeoutMs: creds.timeoutMs,
  });
}

type Rec = Record<string, unknown>;

/** First present, non-empty string among the candidate keys. */
export function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = (obj as Rec)[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** First present numeric value among the candidate keys (accepts numeric strings). */
export function pickNumber(obj: unknown, keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = (obj as Rec)[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Euros (Skrime price lists are decimal euros) → minor units. */
export function eurosToCents(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.round(v * 100);
}

/** Skrime's `data` for list endpoints is either an array or an object keyed by id. */
export function asList(data: unknown): Rec[] {
  if (Array.isArray(data)) return data.filter((x): x is Rec => !!x && typeof x === 'object');
  if (data && typeof data === 'object') {
    return Object.entries(data as Rec).map(([key, value]) =>
      value && typeof value === 'object' ? { id: key, ...(value as Rec) } : { id: key, name: key },
    );
  }
  return [];
}

/** Maps a price list / image list entry to a dropdown option. */
export function toRemoteOption(entry: Rec): RemoteOption {
  const id = pickString(entry, ['id', 'key', 'slug', 'name']) ?? '';
  const name = pickString(entry, ['name', 'title', 'id']) ?? id;
  const price = pickNumber(entry, ['price', 'monthly', 'priceMonthly', 'create']);
  const extra: RemoteOption['extra'] = {};
  if (price !== undefined) extra.priceEur = price;
  for (const k of [
    'cpu',
    'cores',
    'ram',
    'memory',
    'disk',
    'storage',
    'traffic',
    'domains',
    'webspace',
  ]) {
    const v = entry[k];
    if (typeof v === 'string' || typeof v === 'number') extra[k] = v;
  }
  return { id, name, extra };
}

/** Normalises the many ways a Skrime status may be spelled. */
export function normaliseStatus(
  raw: string | undefined,
): 'active' | 'pending' | 'suspended' | 'cancelled' | 'unknown' {
  const s = (raw ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (['active', 'running', 'online', 'ok', 'aktiv'].includes(s)) return 'active';
  if (['pending', 'installing', 'creating', 'setup', 'processing'].includes(s)) return 'pending';
  if (['suspended', 'locked', 'gesperrt'].includes(s)) return 'suspended';
  if (['cancelled', 'canceled', 'terminated', 'deleted', 'expired', 'gekündigt'].includes(s))
    return 'cancelled';
  return 'unknown';
}

export function isNotFound(err: unknown): boolean {
  return err instanceof SkrimeError && err.code === 'not_found';
}

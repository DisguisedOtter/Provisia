import type { FetchWithTimeout, ServerDTO } from '@provisia/module-sdk';
import type { CpanelCredentials } from './config.js';

export class CpanelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CpanelError';
  }
}

export type WhmParams = Record<string, string | number | boolean | undefined>;

interface WhmEnvelope {
  metadata?: { result?: number | string; reason?: string; version?: number };
  data?: Record<string, unknown>;
}

export const WHM_DEFAULT_PORT = 2087;

export function whmBaseUrl(server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>): string {
  const proto = server.secure ? 'https' : 'http';
  return `${proto}://${server.hostname}:${server.port ?? WHM_DEFAULT_PORT}`;
}

/** Minimal WHM API 1 client (`/json-api/<fn>?api.version=1`), API-token auth. */
export class WhmClient {
  constructor(
    private readonly fetch: FetchWithTimeout,
    private readonly server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>,
    private readonly credentials: CpanelCredentials,
    private readonly timeoutMs = 60_000,
  ) {}

  get baseUrl(): string {
    return whmBaseUrl(this.server);
  }

  async call<T extends Record<string, unknown> = Record<string, unknown>>(
    fn: string,
    params: WhmParams = {},
  ): Promise<T> {
    const body = new URLSearchParams({ 'api.version': '1' });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      body.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/json-api/${fn}`, {
        method: 'POST',
        headers: {
          Authorization: `whm ${this.credentials.username}:${this.credentials.apiToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new CpanelError('connection_failed', `WHM request failed: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new CpanelError('auth_failed', `WHM rejected the API token (HTTP ${res.status})`);
    }
    const text = await res.text();
    let json: WhmEnvelope;
    try {
      json = JSON.parse(text) as WhmEnvelope;
    } catch {
      throw new CpanelError(
        'invalid_response',
        `WHM returned a non-JSON response (HTTP ${res.status})`,
        { body: text.slice(0, 500) },
      );
    }
    if (!res.ok) {
      throw new CpanelError('http_error', json.metadata?.reason ?? `WHM HTTP ${res.status}`, json);
    }
    if (String(json.metadata?.result ?? '0') !== '1') {
      throw new CpanelError('api_error', json.metadata?.reason ?? `WHM ${fn} failed`, json.data);
    }
    return (json.data ?? {}) as T;
  }
}

/** Parses WHM sizes like `"123M"`, `"1.5G"`, `"unlimited"`, `"0"` into MB (null = unlimited). */
export function parseWhmSizeMb(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (s === '' || s === 'unlimited' || s === 'none') return null;
  const m = /^([\d.]+)\s*([kmgt]?)b?$/.exec(s);
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  switch (m[2]) {
    case 'k':
      return n / 1024;
    case 'g':
      return n * 1024;
    case 't':
      return n * 1024 * 1024;
    default:
      return n; // WHM reports plain numbers in MB
  }
}

import type { FetchWithTimeout, ServerDTO } from '@provisia/module-sdk';
import type { DirectadminCredentials } from './config.js';

export class DirectadminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DirectadminError';
  }
}

export const DA_DEFAULT_PORT = 2222;

export type DaParams = Record<string, string | number | boolean | undefined>;
export type DaResponse = Record<string, unknown>;

export function daBaseUrl(server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>): string {
  const proto = server.secure ? 'https' : 'http';
  return `${proto}://${server.hostname}:${server.port ?? DA_DEFAULT_PORT}`;
}

/**
 * Parses DirectAdmin's URL-encoded responses: `error=0&text=...&details=...` or lists such as
 * `list[]=a&list[]=b`. Repeated `key[]` become arrays.
 */
export function parseUrlEncoded(body: string): DaResponse {
  const out: DaResponse = {};
  const params = new URLSearchParams(body.trim());
  for (const [rawKey, value] of params) {
    if (rawKey.endsWith('[]')) {
      const key = rawKey.slice(0, -2);
      const arr = (out[key] as string[] | undefined) ?? [];
      arr.push(value);
      out[key] = arr;
    } else {
      out[rawKey] = value;
    }
  }
  return out;
}

/** Decodes a DirectAdmin response body: JSON when `json=yes` was honoured, otherwise URL-encoded. */
export function parseDaBody(body: string, contentType: string | null): DaResponse | unknown[] {
  const trimmed = body.trim();
  if (contentType?.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as DaResponse | unknown[];
    } catch {
      /* fall through to url-encoded */
    }
  }
  return parseUrlEncoded(trimmed);
}

/** DirectAdmin API client (CMD_API_* commands, login-key / password basic auth). */
export class DirectadminClient {
  constructor(
    private readonly fetch: FetchWithTimeout,
    private readonly server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>,
    private readonly credentials: DirectadminCredentials,
    private readonly timeoutMs = 60_000,
  ) {}

  get baseUrl(): string {
    return daBaseUrl(this.server);
  }

  /**
   * Runs a command. `loginAs` uses DirectAdmin's `admin|user` impersonation syntax so a command runs in
   * the context of a user owned by the API account (needed for SSO keys).
   */
  async call(
    command: string,
    params: DaParams = {},
    opts: { method?: 'GET' | 'POST'; loginAs?: string } = {},
  ): Promise<DaResponse> {
    const method = opts.method ?? 'POST';
    const body = new URLSearchParams({ json: 'yes' });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      body.set(k, typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
    }
    const user = opts.loginAs
      ? `${this.credentials.username}|${opts.loginAs}`
      : this.credentials.username;
    const auth = Buffer.from(`${user}:${this.credentials.loginKey}`, 'utf8').toString('base64');
    const url =
      method === 'GET' ? `${this.baseUrl}/${command}?${body}` : `${this.baseUrl}/${command}`;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: method === 'POST' ? body.toString() : undefined,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new DirectadminError(
        'connection_failed',
        `DirectAdmin request failed: ${(err as Error).message}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new DirectadminError(
        'auth_failed',
        `DirectAdmin rejected the login key (HTTP ${res.status})`,
      );
    }
    const text = await res.text();
    const parsed = parseDaBody(text, res.headers.get('content-type'));
    if (!res.ok) {
      throw new DirectadminError('http_error', `DirectAdmin HTTP ${res.status}`, parsed);
    }
    if (Array.isArray(parsed)) return { list: parsed };
    const errorFlag = parsed.error;
    if (errorFlag !== undefined && String(errorFlag) !== '0') {
      const message = [parsed.text, parsed.details]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .join(': ');
      throw new DirectadminError('api_error', message || `${command} failed`, parsed);
    }
    return parsed;
  }
}

/** DirectAdmin reports usage in MB as strings, sometimes `unlimited`. */
export function parseDaNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (s === 'unlimited' || s === '') return undefined;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

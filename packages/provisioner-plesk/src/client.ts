import type { FetchWithTimeout, ServerDTO } from '@provisia/module-sdk';
import type { PleskCredentials } from './config.js';

export class PleskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PleskError';
  }
}

export const PLESK_DEFAULT_PORT = 8443;

export function pleskBaseUrl(server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>): string {
  const proto = server.secure ? 'https' : 'http';
  return `${proto}://${server.hostname}:${server.port ?? PLESK_DEFAULT_PORT}`;
}

/** Plesk REST API (`/api/v2`) client. */
export class PleskClient {
  constructor(
    private readonly fetch: FetchWithTimeout,
    private readonly server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>,
    private readonly credentials: PleskCredentials,
    private readonly timeoutMs = 60_000,
  ) {}

  get baseUrl(): string {
    return pleskBaseUrl(this.server);
  }

  private authHeader(): Record<string, string> {
    if (this.credentials.apiKey) return { 'X-API-Key': this.credentials.apiKey };
    const basic = Buffer.from(
      `${this.credentials.username}:${this.credentials.password}`,
      'utf8',
    ).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/api/v2${path}`, {
        method,
        headers: {
          ...this.authHeader(),
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new PleskError('connection_failed', `Plesk request failed: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) {
          throw new PleskError('invalid_response', 'Plesk returned a non-JSON response', {
            body: text.slice(0, 500),
          });
        }
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new PleskError('auth_failed', `Plesk rejected the credentials (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      throw new PleskError('not_found', messageOf(json) ?? `Plesk: ${path} not found`, json);
    }
    if (!res.ok) {
      throw new PleskError('api_error', messageOf(json) ?? `Plesk HTTP ${res.status}`, json);
    }
    return json as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** `POST /cli/{utility}/call` — runs a `plesk bin` utility; throws when the exit code is not 0. */
  async cli(utility: string, params: string[]): Promise<string> {
    const out = await this.post<{ code?: number; stdout?: string; stderr?: string }>(
      `/cli/${utility}/call`,
      { params },
    );
    if ((out.code ?? 0) !== 0) {
      throw new PleskError('cli_error', out.stderr?.trim() || `plesk bin ${utility} failed`, out);
    }
    return out.stdout ?? '';
  }
}

function messageOf(json: unknown): string | undefined {
  if (json && typeof json === 'object') {
    const j = json as { message?: unknown; error?: unknown };
    if (typeof j.message === 'string') return j.message;
    if (typeof j.error === 'string') return j.error;
  }
  return undefined;
}

export function bytesToMb(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || v === null || v === undefined) return undefined;
  return Math.round((n / 1024 / 1024) * 100) / 100;
}

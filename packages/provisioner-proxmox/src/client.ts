import type { FetchWithTimeout, ServerDTO } from '@provisia/module-sdk';
import type { ProxmoxCredentials } from './config.js';

export class ProxmoxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProxmoxError';
  }
}

export const PVE_DEFAULT_PORT = 8006;
export type PveParams = Record<string, string | number | boolean | undefined>;

export function pveBaseUrl(server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>): string {
  const proto = server.secure ? 'https' : 'http';
  return `${proto}://${server.hostname}:${server.port ?? PVE_DEFAULT_PORT}`;
}

export interface TaskStatus {
  status: 'running' | 'stopped';
  exitstatus?: string;
  type?: string;
  upid: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Proxmox VE API client (`/api2/json`), API token auth. */
export class ProxmoxClient {
  constructor(
    private readonly fetch: FetchWithTimeout,
    private readonly server: Pick<ServerDTO, 'hostname' | 'port' | 'secure'>,
    private readonly credentials: ProxmoxCredentials,
    private readonly timeoutMs = 60_000,
  ) {}

  get baseUrl(): string {
    return pveBaseUrl(this.server);
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: PveParams = {},
  ): Promise<T> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      form.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    const query = method === 'GET' || method === 'DELETE' ? form.toString() : '';
    const url = `${this.baseUrl}/api2/json${path}${query ? `?${query}` : ''}`;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          Authorization: `PVEAPIToken=${this.credentials.tokenId}=${this.credentials.secret}`,
          Accept: 'application/json',
          ...(method === 'POST' || method === 'PUT'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: method === 'POST' || method === 'PUT' ? form.toString() : undefined,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new ProxmoxError(
        'connection_failed',
        `Proxmox request failed: ${(err as Error).message}`,
      );
    }
    const text = await res.text();
    let json: { data?: T; errors?: Record<string, string>; message?: string } = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) {
          throw new ProxmoxError('invalid_response', 'Proxmox returned a non-JSON response', {
            body: text.slice(0, 500),
          });
        }
      }
    }
    if (res.status === 401) {
      throw new ProxmoxError('auth_failed', 'Proxmox rejected the API token (HTTP 401)');
    }
    if (res.status === 403) {
      throw new ProxmoxError(
        'permission_denied',
        `Proxmox token lacks a permission for ${method} ${path} (HTTP 403)`,
      );
    }
    if (!res.ok) {
      const detail = json.errors
        ? Object.entries(json.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ')
        : '';
      const msg = json.message ?? res.statusText ?? `HTTP ${res.status}`;
      throw new ProxmoxError(
        res.status === 404 ? 'not_found' : 'api_error',
        `Proxmox ${method} ${path} failed: ${msg}${detail ? ` (${detail})` : ''}`,
        { status: res.status, body: json },
      );
    }
    return json.data as T;
  }

  get<T = unknown>(path: string, params?: PveParams) {
    return this.request<T>('GET', path, params);
  }
  post<T = unknown>(path: string, params?: PveParams) {
    return this.request<T>('POST', path, params);
  }
  put<T = unknown>(path: string, params?: PveParams) {
    return this.request<T>('PUT', path, params);
  }
  delete<T = unknown>(path: string, params?: PveParams) {
    return this.request<T>('DELETE', path, params);
  }

  /** Polls a task (UPID) until it stops; throws when it fails or exceeds `timeoutMs`. */
  async waitTask(node: string, upid: unknown, timeoutMs: number, pollMs = 2000): Promise<void> {
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) return; // synchronous call
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await this.get<TaskStatus>(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );
      if (status.status === 'stopped') {
        if (status.exitstatus && status.exitstatus !== 'OK') {
          throw new ProxmoxError(
            'task_failed',
            `Proxmox task failed: ${status.exitstatus}`,
            status,
          );
        }
        return;
      }
      if (Date.now() >= deadline) {
        throw new ProxmoxError(
          'task_timeout',
          `Proxmox task did not finish within ${timeoutMs}ms`,
          {
            upid,
          },
        );
      }
      await sleep(pollMs);
    }
  }
}

export const bytesToMb = (v: unknown) => Math.round((Number(v ?? 0) / 1024 / 1024) * 10) / 10;

/** Pulls a static IP out of `ip=203.0.113.5/24,gw=...`; undefined for dhcp. */
export function staticIpOf(ipConfig: string): string | undefined {
  const m = /(?:^|,)ip=([0-9a-fA-F.:]+)(?:\/\d+)?(?:,|$)/.exec(ipConfig);
  return m?.[1] && m[1] !== 'dhcp' ? m[1] : undefined;
}

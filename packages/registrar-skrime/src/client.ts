import type { FetchWithTimeout, ModuleLogger } from '@provisia/module-sdk';
import { classifyMessage, SkrimeError } from './errors.js';

export const SKRIME_DEFAULT_BASE_URL = 'https://skrime.eu/api';

/** Every Skrime response is wrapped in this envelope (ported from the WHMCS reference module). */
export interface SkrimeEnvelope<T = unknown> {
  state: 'success' | 'error' | string;
  /** Human readable message, e.g. "No product found". */
  response?: string;
  data?: T;
}

export interface SkrimeClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch: FetchWithTimeout;
  logger: ModuleLogger;
  timeoutMs?: number;
  /**
   * Where GET parameters go. Skrime's documentation shows them as a JSON request body (the PHP reference
   * module sent them that way too); the Fetch API forbids a GET body, so `body` mode uses a raw
   * `node:https` request. `query` (default) sends them as a query string through `fetch`.
   */
  getParamsIn?: 'query' | 'body';
  /** Raw request implementation for `getParamsIn: 'body'` (injectable for tests). */
  rawRequest?: RawRequestFn;
  /** Attempts for retryable failures (5xx, network, 429). Default 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff in ms. Default 500 (tests pass 0). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RawRequestFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number },
) => Promise<Response>;

/** `node:https` request that, unlike fetch, allows a body on GET. Resolves to a standard `Response`. */
export const nodeRawRequest: RawRequestFn = async (url, init) => {
  const { request } = url.startsWith('http://')
    ? await import('node:http')
    : await import('node:https');
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method,
        headers: { ...init.headers, 'content-length': String(Buffer.byteLength(init.body ?? '')) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(', ') : (v ?? ''),
                ]),
              ),
            }),
          ),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(init.timeoutMs, () =>
      req.destroy(new Error(`request timed out after ${init.timeoutMs}ms`)),
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
};

/**
 * Thin HTTP client for `https://skrime.eu/api`.
 *
 * Deviation from the PHP reference: Guzzle sent a JSON body on GET requests (`domain/single`,
 * `domain/nameserver`, ...). The Fetch standard forbids a GET body, so GET parameters are sent as a
 * query string instead. Verify this against a live key (see README "Sandbox / first live run").
 */
export class SkrimeClient {
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SkrimeClientOptions) {
    this.baseUrl = (opts.baseUrl ?? SKRIME_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('GET', endpoint, params);
  }

  post<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  delete<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('DELETE', endpoint, body);
  }

  /** Returns `data` of a successful envelope; throws `SkrimeError` otherwise. */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    let url = `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;
    const init: RequestInit & { timeoutMs?: number } = {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeoutMs: this.opts.timeoutMs ?? 30_000,
    };
    if (method === 'GET' && this.opts.getParamsIn !== 'body') {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])),
      ).toString();
      if (qs) url += `?${qs}`;
    } else if (Object.keys(payload).length > 0 || method !== 'GET') {
      init.body = JSON.stringify(payload);
    }

    let lastError: SkrimeError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.once<T>(url, init, method, endpoint);
      } catch (err) {
        if (!(err instanceof SkrimeError) || !err.retryable || attempt === this.maxAttempts) {
          throw err;
        }
        lastError = err;
        const delay = this.backoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
        this.opts.logger.warn(
          { endpoint, attempt, delay, code: err.code, status: err.httpStatus },
          'skrime request failed, retrying',
        );
        await this.sleep(delay);
      }
    }
    throw lastError ?? new SkrimeError('upstream_error', 'request failed');
  }

  private async once<T>(
    url: string,
    init: RequestInit & { timeoutMs?: number },
    method: string,
    endpoint: string,
  ): Promise<T> {
    let res: Response;
    try {
      if (method === 'GET' && init.body !== undefined) {
        res = await (this.opts.rawRequest ?? nodeRawRequest)(url, {
          method,
          headers: init.headers as Record<string, string>,
          body: init.body as string,
          timeoutMs: init.timeoutMs ?? 30_000,
        });
      } else {
        res = await this.opts.fetch(url, init);
      }
    } catch (err) {
      throw new SkrimeError(
        'network_error',
        `Skrime ${method} ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        true,
      );
    }

    const text = await res.text();
    let json: SkrimeEnvelope<T> | undefined;
    if (text) {
      try {
        json = JSON.parse(text) as SkrimeEnvelope<T>;
      } catch {
        json = undefined;
      }
    }
    const message = json?.response ?? (text ? text.slice(0, 200) : res.statusText);

    if (res.status === 401 || res.status === 403) {
      throw new SkrimeError('auth_failed', `Skrime rejected the API key: ${message}`, res.status);
    }
    if (res.status === 404) {
      throw new SkrimeError('not_found', `Skrime: ${message || 'not found'}`, 404);
    }
    if (res.status === 429) {
      throw new SkrimeError('rate_limited', `Skrime rate limit: ${message}`, 429, true);
    }
    if (res.status >= 500) {
      throw new SkrimeError('upstream_error', `Skrime ${res.status}: ${message}`, res.status, true);
    }
    if (!json || typeof json !== 'object') {
      throw new SkrimeError(
        'invalid_response',
        `Skrime ${method} ${endpoint}: non-JSON response (HTTP ${res.status})`,
        res.status,
      );
    }
    if (json.state !== 'success') {
      const msg = json.response ?? `HTTP ${res.status}`;
      throw new SkrimeError(classifyMessage(msg), `Skrime: ${msg}`, res.status, false, json);
    }
    if (res.status >= 400) {
      throw new SkrimeError('upstream_error', `Skrime ${res.status}: ${message}`, res.status);
    }
    return (json.data ?? ({} as T)) as T;
  }
}

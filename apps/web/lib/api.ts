import type { AuthUser, ErrorEnvelope, LoginRequest, Paginated } from '@provisia/shared';

/**
 * Typed fetch client for the Provisia API. Sends the session cookie (`credentials: 'include'`) and
 * unwraps the `{ data }` / `{ data, meta }` envelopes. Throws `ApiError` on non-2xx responses.
 *
 * Feature agents add endpoint groups below (`api.clients.list(...)`) and keep the generic helpers as is.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`${API_URL}/api/v1${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as ErrorEnvelope | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return json as T;
}

export const http = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export type Data<T> = { data: T };
export type { Paginated };

export const api = {
  auth: {
    login: (body: LoginRequest) => http.post<Data<AuthUser>>('/auth/login', body),
    logout: () => http.post<void>('/auth/logout'),
    me: (signal?: AbortSignal) => http.get<Data<AuthUser>>('/auth/me', undefined, signal),
  },
};

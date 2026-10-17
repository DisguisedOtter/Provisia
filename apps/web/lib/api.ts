import type {
  ApiKey,
  AuthUser,
  ChangeOwnPasswordRequest,
  CreateApiKey,
  CreatedApiKey,
  ErrorEnvelope,
  Login2faRequest,
  LoginRequest,
  LoginResponse,
  Paginated,
  PublicSettings,
  RegisterRequest,
  Session,
  TotpStatus,
} from '@provisia/shared';

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
    login: (body: LoginRequest) => http.post<LoginResponse>('/auth/login', body),
    login2fa: (body: Login2faRequest) => http.post<Data<AuthUser>>('/auth/login/2fa', body),
    logout: () => http.post<void>('/auth/logout'),
    me: (signal?: AbortSignal) => http.get<Data<AuthUser>>('/auth/me', undefined, signal),
    register: (body: RegisterRequest) =>
      http.post<{ data: AuthUser; verificationRequired: boolean }>('/auth/register', body),
    verifyEmail: (token: string) => http.post<Data<{ ok: true }>>('/auth/verify-email', { token }),
    resendVerification: (email: string) => http.post<void>('/auth/resend-verification', { email }),
    forgotPassword: (email: string) => http.post<void>('/auth/forgot-password', { email }),
    checkResetToken: (token: string, type: 'reset' | 'invite' = 'reset') =>
      http.get<Data<{ valid: boolean; email: string | null }>>('/auth/reset-password', {
        token,
        type,
      }),
    resetPassword: (body: { token: string; password: string }) =>
      http.post<Data<{ ok: true }>>('/auth/reset-password', body),
    acceptInvite: (body: { token: string; password: string }) =>
      http.post<Data<AuthUser>>('/auth/accept-invite', body),
    changePassword: (body: ChangeOwnPasswordRequest) =>
      http.post<Data<{ ok: true }>>('/auth/change-password', body),
    sessions: {
      list: () => http.get<Data<Session[]>>('/auth/sessions'),
      revoke: (id: string) => http.delete<void>(`/auth/sessions/${id}`),
      revokeOthers: () => http.delete<Data<{ revoked: number }>>('/auth/sessions'),
    },
    twoFactor: {
      status: () => http.get<Data<TotpStatus>>('/auth/2fa'),
      setup: () =>
        http.post<Data<{ otpauthUrl: string; qrDataUrl: string; secret: string }>>(
          '/auth/2fa/setup',
        ),
      confirm: (code: string) =>
        http.post<Data<{ backupCodes: string[] }>>('/auth/2fa/confirm', { code }),
      regenerateBackupCodes: (code: string) =>
        http.post<Data<{ backupCodes: string[] }>>('/auth/2fa/backup-codes', { code }),
      disable: (body: { password: string; code: string }) =>
        http.post<Data<{ ok: true }>>('/auth/2fa/disable', body),
    },
    apiKeys: {
      list: () => http.get<Data<ApiKey[]>>('/auth/api-keys'),
      create: (body: CreateApiKey) => http.post<Data<CreatedApiKey>>('/auth/api-keys', body),
      revoke: (id: string) => http.delete<void>(`/auth/api-keys/${id}`),
    },
    impersonate: (userId: string) => http.post<Data<AuthUser>>('/auth/impersonate', { userId }),
    stopImpersonation: () => http.post<Data<AuthUser>>('/auth/impersonate/stop'),
  },
  publicSettings: (signal?: AbortSignal) =>
    http.get<Data<PublicSettings>>('/public/settings', undefined, signal),
};

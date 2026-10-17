import type { GatewayContext } from '@provisia/module-sdk';
import type { StripeConfig } from './config.js';

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly body: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

type Params = Record<string, unknown>;

/** Stripe wants `application/x-www-form-urlencoded` with bracket notation for nested values. */
export function encodeForm(
  params: Params,
  prefix = '',
  out = new URLSearchParams(),
): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object')
          encodeForm(item as Params, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof value === 'object') {
      encodeForm(value as Params, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

export interface StripeRequestOptions {
  idempotencyKey?: string;
  /** Expected status codes besides 2xx that should resolve instead of throw. */
  stripeAccount?: string;
}

export async function stripeRequest<T = Record<string, unknown>>(
  ctx: GatewayContext<StripeConfig>,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Params = {},
  opts: StripeRequestOptions = {},
): Promise<T> {
  const base = ctx.config.apiBaseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    authorization: `Bearer ${ctx.config.secretKey}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const encoded = encodeForm(params).toString();
  const url = method === 'GET' && encoded ? `${base}${path}?${encoded}` : `${base}${path}`;
  const res = await ctx.fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : encoded,
    timeoutMs: 30_000,
  });
  const text = await res.text();
  let body: Record<string, unknown> | undefined;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const err = (body?.error ?? {}) as Record<string, unknown>;
    throw new StripeApiError(
      typeof err.message === 'string' ? err.message : `Stripe request failed (${res.status})`,
      res.status,
      typeof err.code === 'string' ? err.code : undefined,
      body,
    );
  }
  return body as T;
}

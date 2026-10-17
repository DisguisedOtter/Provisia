import { createHash } from 'node:crypto';
import type { GatewayContext } from '@provisia/module-sdk';
import { type PaypalConfig, paypalBaseUrl } from './config.js';

export class PaypalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issue: string | undefined,
    public readonly body: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'PaypalApiError';
  }
}

type Ctx = GatewayContext<PaypalConfig>;
type Obj = Record<string, unknown>;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Clears the OAuth token cache (tests). */
export function resetTokenCache(): void {
  tokenCache.clear();
}

export async function getAccessToken(ctx: Ctx): Promise<string> {
  const base = paypalBaseUrl(ctx.config);
  const cacheKey = `${base}:${ctx.config.clientId}:${createHash('sha256').update(ctx.config.clientSecret).digest('hex').slice(0, 16)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${ctx.config.clientId}:${ctx.config.clientSecret}`).toString('base64');
  const res = await ctx.fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    timeoutMs: 20_000,
  });
  const body = (await res.json().catch(() => ({}))) as Obj;
  if (!res.ok || typeof body.access_token !== 'string') {
    throw new PaypalApiError(
      typeof body.error_description === 'string'
        ? body.error_description
        : 'PayPal authentication failed',
      res.status,
      typeof body.error === 'string' ? body.error : undefined,
      body,
    );
  }
  const ttl = typeof body.expires_in === 'number' ? body.expires_in * 1000 : 60_000;
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + ttl });
  return body.access_token;
}

export interface PaypalRequestOptions {
  /** PayPal-Request-Id for idempotent POSTs. */
  requestId?: string;
  /** Pass a pre-serialised body (webhook verification must embed the raw event bytes). */
  rawBody?: string;
}

export async function paypalRequest<T = Obj>(
  ctx: Ctx,
  method: 'GET' | 'POST',
  path: string,
  body?: Obj,
  opts: PaypalRequestOptions = {},
): Promise<T> {
  const token = await getAccessToken(ctx);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  };
  if (opts.requestId) headers['paypal-request-id'] = opts.requestId;
  const res = await ctx.fetch(`${paypalBaseUrl(ctx.config)}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : (opts.rawBody ?? JSON.stringify(body ?? {})),
    timeoutMs: 30_000,
  });
  const text = await res.text();
  let parsed: Obj | undefined;
  try {
    parsed = text ? (JSON.parse(text) as Obj) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const details = (parsed?.details as Obj[] | undefined) ?? [];
    const issue = typeof details[0]?.issue === 'string' ? details[0].issue : undefined;
    const message =
      (typeof details[0]?.description === 'string' && details[0].description) ||
      (typeof parsed?.message === 'string' && parsed.message) ||
      `PayPal request failed (${res.status})`;
    throw new PaypalApiError(
      message,
      res.status,
      issue ?? (parsed?.name as string | undefined),
      parsed,
    );
  }
  return parsed as T;
}

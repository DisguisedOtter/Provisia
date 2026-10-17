import type { GatewayContext } from '@provisia/module-sdk';
import type { MollieConfig } from './config.js';

export class MollieApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'MollieApiError';
  }
}

type Obj = Record<string, unknown>;

export async function mollieRequest<T = Obj>(
  ctx: GatewayContext<MollieConfig>,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Obj,
  opts: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${ctx.config.apiKey}`,
    'content-type': 'application/json',
    'user-agent': 'Provisia/1.0 (+https://provisia.dev)',
  };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await ctx.fetch(`${ctx.config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    const detail = typeof parsed?.detail === 'string' ? parsed.detail : undefined;
    const title = typeof parsed?.title === 'string' ? parsed.title : undefined;
    throw new MollieApiError(
      detail ?? title ?? `Mollie request failed (${res.status})`,
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

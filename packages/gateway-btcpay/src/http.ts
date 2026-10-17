import type { GatewayContext } from '@provisia/module-sdk';
import type { BtcpayConfig } from './config.js';

export class BtcpayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'BtcpayApiError';
  }
}

type Obj = Record<string, unknown>;

export async function btcpayRequest<T = Obj>(
  ctx: GatewayContext<BtcpayConfig>,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Obj,
): Promise<T> {
  const res = await ctx.fetch(`${ctx.config.serverUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: { authorization: `token ${ctx.config.apiKey}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 30_000,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const p = (parsed ?? {}) as Obj;
    const first = Array.isArray(parsed) ? (parsed[0] as Obj | undefined) : undefined;
    const message =
      (typeof p.message === 'string' && p.message) ||
      (typeof first?.message === 'string' && first.message) ||
      `BTCPay request failed (${res.status})`;
    throw new BtcpayApiError(message, res.status, parsed);
  }
  return parsed as T;
}

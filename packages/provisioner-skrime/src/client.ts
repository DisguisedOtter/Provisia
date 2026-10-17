import type { ModuleContext, RemoteOption, ServerDTO } from '@provisia/module-sdk';
import { SkrimeClient, SkrimeError } from '@provisia/registrar-skrime';
import { type SkrimeCredentials, skrimeCredentialsSchema } from './config.js';
import { SKRIME_ENDPOINTS } from './endpoints.js';

export { SkrimeClient, SkrimeError } from '@provisia/registrar-skrime';

export class SkrimeProvisionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SkrimeProvisionError';
  }
}

type Rec = Record<string, unknown>;

/** Builds the API client from the server row's (decrypted) credentials. */
export function clientFor(ctx: ModuleContext<unknown>, server: ServerDTO | null): SkrimeClient {
  if (!server)
    throw new SkrimeProvisionError('no_server', 'Service has no Skrime account assigned');
  const creds = skrimeCredentialsSchema.parse(ctx.credentials) as SkrimeCredentials;
  return new SkrimeClient({
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    fetch: ctx.fetch,
    logger: ctx.logger,
    timeoutMs: creds.timeoutMs,
    getParamsIn: creds.getParamsIn,
  });
}

export function str(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = (obj as Rec)[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

export function num(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = (obj as Rec)[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function rec(obj: unknown, key: string): Rec | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = (obj as Rec)[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

export function list(data: unknown): Rec[] {
  return Array.isArray(data) ? data.filter((x): x is Rec => !!x && typeof x === 'object') : [];
}

/** Skrime prices are decimal euro strings (`"4.99"`). */
export function eurosToCents(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.round(v * 100);
}

/** Recurring cost of a product/plan: `finalRenewPrice` when present, else `price`. */
export function recurringCents(product: unknown): number | undefined {
  return eurosToCents(num(product, 'finalRenewPrice') ?? num(product, 'price'));
}

/** `GET server/pricelist { type: 'server' }` entry → dropdown option. */
export function serverPlanOption(plan: Rec): RemoteOption {
  const info = rec(plan, 'productInfo') ?? {};
  const cores = num(info, 'cores');
  const memoryMb = num(info, 'memory');
  const diskGb = num(info, 'disk');
  const parts = [
    cores !== undefined ? `${cores} vCPU` : null,
    memoryMb !== undefined ? `${Math.round(memoryMb / 1024)} GB RAM` : null,
    diskGb !== undefined ? `${diskGb} GB` : null,
    str(info, 'type')?.toUpperCase() ?? null,
  ].filter(Boolean);
  const price = num(plan, 'finalRenewPrice') ?? num(plan, 'price');
  return {
    id: str(plan, 'id') ?? '',
    name: `${parts.join(' · ')}${price !== undefined ? ` – € ${price.toFixed(2)}/mo` : ''}`,
    extra: {
      priceEur: price ?? null,
      cores: cores ?? null,
      memoryMb: memoryMb ?? null,
      diskGb: diskGb ?? null,
      type: str(info, 'type') ?? null,
    },
  };
}

/** `GET server/os` entry → dropdown option keyed by `proxmoxId` (what `server/order` wants as `osName`). */
export function osOption(os: Rec): RemoteOption {
  return {
    id: str(os, 'proxmoxId') ?? str(os, 'id') ?? '',
    name: str(os, 'name') ?? str(os, 'proxmoxId') ?? '',
    extra: {
      group: str(os, 'group') ?? null,
      type: str(os, 'type') ?? null,
      minDisk: num(os, 'minDisk') ?? null,
    },
  };
}

/** `GET webspace/pricelist` entry → dropdown option. */
export function webspacePlanOption(plan: Rec): RemoteOption {
  const info = rec(plan, 'productInfo') ?? {};
  const price = num(plan, 'finalRenewPrice') ?? num(plan, 'price');
  const disk = num(info, 'disk');
  return {
    id: str(plan, 'id') ?? '',
    name: `${str(info, 'name') ?? str(plan, 'id') ?? ''}${disk !== undefined ? ` (${disk} GB)` : ''}${price !== undefined ? ` – € ${price.toFixed(2)}/mo` : ''}`,
    extra: { priceEur: price ?? null, diskGb: disk ?? null },
  };
}

export function isNotFound(err: unknown): boolean {
  return err instanceof SkrimeError && err.code === 'not_found';
}

/** Sets Skrime's auto renewal for a product; errors are logged, never fatal (billing still works). */
export async function setAutoRenew(
  api: SkrimeClient,
  ctx: ModuleContext<unknown>,
  productId: string,
  autoRenew: boolean,
): Promise<boolean> {
  try {
    await api.post(SKRIME_ENDPOINTS.product.autorenew, { productId, autoRenew });
    return true;
  } catch (err) {
    ctx.logger.warn({ err, productId, autoRenew }, 'skrime: could not set auto renewal');
    return false;
  }
}

/** Names the product in the Skrime panel after the client/hostname; best effort. */
export async function nameProduct(
  api: SkrimeClient,
  ctx: ModuleContext<unknown>,
  productId: string,
  name: string,
) {
  try {
    await api.post(SKRIME_ENDPOINTS.product.name, { productId, name: name.slice(0, 50) });
  } catch (err) {
    ctx.logger.warn({ err, productId }, 'skrime: could not set product name');
  }
}

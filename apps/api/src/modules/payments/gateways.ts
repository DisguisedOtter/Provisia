/**
 * Gateway configuration storage and module-context construction. Plain `(db, …)` functions without
 * Fastify types so the worker (`apps/worker/src/jobs/payments.ts`) can share them.
 */
import { type Db, paymentGateways } from '@provisia/db';
import {
  createModuleContext,
  decryptJson,
  encryptJson,
  type GatewayContext,
  type ModuleLogger,
  type ModuleRegistry,
  type PaymentGateway,
} from '@provisia/module-sdk';
import { MASKED_SECRET, type PaymentGatewayInfo } from '@provisia/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export type GatewayRow = typeof paymentGateways.$inferSelect;

const SECRET_RE = /secret|password|token|private/i;
const KEY_RE = /key/i;
const PUBLIC_RE = /^(publishable|public|webhookid|storeid|clientid|mode|flow)/i;

export function isSecretKey(key: string): boolean {
  if (PUBLIC_RE.test(key)) return false;
  return SECRET_RE.test(key) || KEY_RE.test(key);
}

/** Replaces secret-looking string values with `MASKED_SECRET` for the admin API. */
export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = isSecretKey(k) && typeof v === 'string' && v ? MASKED_SECRET : v;
  }
  return out;
}

/** Non-secret values the browser may receive (e.g. Stripe publishable key). */
export function publicConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (/^(publishable|public)/i.test(k)) out[k] = v;
  }
  return out;
}

export async function listGatewayRows(db: Db): Promise<GatewayRow[]> {
  return db
    .select()
    .from(paymentGateways)
    .orderBy(paymentGateways.sortOrder, paymentGateways.gatewayId);
}

export async function getGatewayRow(db: Db, gatewayId: string): Promise<GatewayRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentGateways)
    .where(eq(paymentGateways.gatewayId, gatewayId))
    .limit(1);
  return row;
}

/** Decrypted + schema-validated config, or null when never configured / invalid. */
export function decryptGatewayConfig(
  gateway: PaymentGateway,
  row: GatewayRow | undefined,
  appKey?: string,
): Record<string, unknown> | null {
  if (!row?.configEncrypted) return null;
  let raw: unknown;
  try {
    raw = decryptJson(row.configEncrypted, appKey);
  } catch {
    return null;
  }
  const parsed = gateway.configSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

export function describeGateway(
  gateway: PaymentGateway,
  row: GatewayRow | undefined,
  appKey?: string,
): PaymentGatewayInfo {
  const config = decryptGatewayConfig(gateway, row, appKey);
  return {
    id: gateway.id,
    name: gateway.name,
    version: gateway.version,
    capabilities: gateway.capabilities,
    displayName: row?.displayName ?? null,
    enabled: row?.enabled ?? false,
    configured: config !== null,
    config: maskConfig(config ?? {}),
    configSchema: z.toJSONSchema(gateway.configSchema, { io: 'input' }) as Record<string, unknown>,
    sortOrder: row?.sortOrder ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

export interface SaveGatewayInput {
  config: Record<string, unknown>;
  enabled?: boolean;
  displayName?: string | null;
  sortOrder?: number;
}

/**
 * Validates and stores the config encrypted. Masked values (`MASKED_SECRET`) keep the previously stored value
 * so the admin form can round-trip without re-entering secrets.
 */
export async function saveGatewayConfig(
  db: Db,
  gateway: PaymentGateway,
  input: SaveGatewayInput,
  appKey?: string,
): Promise<GatewayRow> {
  const existing = await getGatewayRow(db, gateway.id);
  const previous = decryptGatewayConfig(gateway, existing, appKey) ?? {};
  const merged: Record<string, unknown> = { ...input.config };
  for (const [k, v] of Object.entries(merged)) {
    if (v === MASKED_SECRET) {
      if (previous[k] === undefined) {
        throw new GatewayError(
          'validation_error',
          `Config value "${k}" is masked but nothing is stored`,
          400,
        );
      }
      merged[k] = previous[k];
    }
  }
  const parsed = gateway.configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new GatewayError(
      'validation_error',
      'Gateway configuration is invalid',
      400,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  assertVendorApiHost(gateway.id, parsed.data);
  const configEncrypted = encryptJson(parsed.data, appKey);
  const values = {
    configEncrypted,
    enabled: input.enabled ?? existing?.enabled ?? false,
    displayName:
      input.displayName === undefined ? (existing?.displayName ?? null) : input.displayName,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
  };
  const [row] = existing
    ? await db
        .update(paymentGateways)
        .set(values)
        .where(eq(paymentGateways.id, existing.id))
        .returning()
    : await db
        .insert(paymentGateways)
        .values({ gatewayId: gateway.id, ...values })
        .returning();
  if (!row) throw new Error('gateway upsert failed');
  return row;
}

export async function setGatewayEnabled(
  db: Db,
  gateway: PaymentGateway,
  enabled: boolean,
  appKey?: string,
): Promise<GatewayRow> {
  const existing = await getGatewayRow(db, gateway.id);
  if (enabled && !decryptGatewayConfig(gateway, existing, appKey)) {
    throw new GatewayError(
      'gateway_not_configured',
      `Gateway "${gateway.id}" must be configured before enabling`,
    );
  }
  const [row] = existing
    ? await db
        .update(paymentGateways)
        .set({ enabled })
        .where(eq(paymentGateways.id, existing.id))
        .returning()
    : await db.insert(paymentGateways).values({ gatewayId: gateway.id, enabled }).returning();
  if (!row) throw new Error('gateway upsert failed');
  return row;
}

export interface GatewayDeps {
  db: Db;
  modules: ModuleRegistry;
  appKey?: string;
  appUrl: string;
  webUrl: string;
  logger: ModuleLogger;
}

export interface ResolvedGateway {
  gateway: PaymentGateway;
  ctx: GatewayContext;
  row: GatewayRow;
  config: Record<string, unknown>;
}

/**
 * Module + context for a gateway id. `requireEnabled` is false for webhooks/returns/refunds so in-flight
 * payments of a gateway an admin just disabled still settle.
 */
export async function resolveGateway(
  deps: GatewayDeps,
  gatewayId: string,
  opts: { requireEnabled?: boolean } = {},
): Promise<ResolvedGateway> {
  const gateway = deps.modules.find('gateway', gatewayId);
  if (!gateway)
    throw new GatewayError(
      'gateway_not_installed',
      `Payment gateway "${gatewayId}" is not installed`,
      404,
    );
  const row = await getGatewayRow(deps.db, gatewayId);
  const config = decryptGatewayConfig(gateway, row, deps.appKey);
  if (!row || !config) {
    throw new GatewayError(
      'gateway_not_configured',
      `Payment gateway "${gatewayId}" is not configured`,
    );
  }
  if (opts.requireEnabled !== false && !row.enabled) {
    throw new GatewayError('gateway_disabled', `Payment gateway "${gatewayId}" is disabled`);
  }
  const ctx = createModuleContext({
    config,
    logger: deps.logger,
    appUrl: deps.appUrl,
    webUrl: deps.webUrl,
  });
  return { gateway, ctx, row, config };
}

/** Enabled + configured gateways, for the portal. */
export async function enabledGateways(deps: GatewayDeps): Promise<PaymentGateway[]> {
  const rows = await listGatewayRows(deps.db);
  const out: PaymentGateway[] = [];
  for (const row of rows) {
    if (!row.enabled) continue;
    const gateway = deps.modules.find('gateway', row.gatewayId);
    if (gateway && decryptGatewayConfig(gateway, row, deps.appKey)) out.push(gateway);
  }
  return out;
}

/** Vendor API hosts a gateway may talk to; an attacker-chosen host would receive the secret key. */
const VENDOR_API_HOSTS: Record<string, string[]> = {
  stripe: ['api.stripe.com'],
  mollie: ['api.mollie.com'],
  paypal: [
    'api-m.paypal.com',
    'api-m.sandbox.paypal.com',
    'api.paypal.com',
    'api.sandbox.paypal.com',
  ],
};

function assertVendorApiHost(gatewayId: string, config: Record<string, unknown>) {
  const allowed = VENDOR_API_HOSTS[gatewayId];
  const raw = config.apiBaseUrl;
  if (!allowed || typeof raw !== 'string' || !raw) return;
  let host = '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') throw new Error('not https');
    host = u.hostname;
  } catch {
    throw new GatewayError('invalid_config', 'apiBaseUrl must be an https URL', 400);
  }
  if (!allowed.includes(host)) {
    throw new GatewayError(
      'invalid_config',
      `apiBaseUrl must point at ${allowed.join(' or ')}; the API key is sent to this host`,
      400,
    );
  }
}

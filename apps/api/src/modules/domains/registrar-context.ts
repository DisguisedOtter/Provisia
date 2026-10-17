import { type Db, registrarAccounts } from '@provisia/db';
import {
  createModuleContext,
  decryptJson,
  type ModuleContext,
  type ModuleLogger,
  type ModuleRegistry,
  type Registrar,
} from '@provisia/module-sdk';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

const SECRET_KEY_RE = /key|secret|token|password/i;

export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' && v ? maskValue(v) : v;
  }
  return out;
}

export function maskValue(v: string): string {
  return `***${v.slice(-4)}`;
}

/** Decrypted, schema-validated config for a registrar module, or null when not configured. */
export async function loadRegistrarConfig(
  db: Db,
  registrar: Registrar,
  appKey?: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({
      configEncrypted: registrarAccounts.configEncrypted,
      enabled: registrarAccounts.enabled,
    })
    .from(registrarAccounts)
    .where(eq(registrarAccounts.module, registrar.id))
    .limit(1);
  if (!row?.enabled) return null;
  const raw = decryptJson<Record<string, unknown>>(row.configEncrypted, appKey);
  const parsed = registrar.configSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

export interface RegistrarCallOptions {
  db: Db;
  modules: ModuleRegistry;
  module: string;
  appKey?: string;
  appUrl: string;
  webUrl: string;
  logger: ModuleLogger;
}

/** Resolves the registrar module + a ModuleContext; throws AppError when missing or unconfigured. */
export async function resolveRegistrar(
  opts: RegistrarCallOptions,
): Promise<{ registrar: Registrar; ctx: ModuleContext }> {
  const registrar = opts.modules.find('registrar', opts.module);
  if (!registrar) {
    throw new AppError(
      'registrar_not_installed',
      `Registrar module "${opts.module}" is not installed`,
      409,
    );
  }
  const config = await loadRegistrarConfig(opts.db, registrar, opts.appKey);
  if (!config) {
    throw new AppError(
      'registrar_not_configured',
      `Registrar module "${opts.module}" is not configured or disabled`,
      409,
    );
  }
  const ctx = createModuleContext({
    config,
    logger: opts.logger,
    appUrl: opts.appUrl,
    webUrl: opts.webUrl,
  });
  return { registrar, ctx };
}

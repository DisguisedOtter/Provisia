import {
  type Db,
  domainAlerts,
  domainContacts,
  domainSyncLog,
  domains,
  registrarAccounts,
  tldPrices,
  tlds,
} from '@provisia/db';
import {
  decrypt,
  encryptJson,
  type ModuleLogger,
  type ModuleRegistry,
  type Registrar,
} from '@provisia/module-sdk';
import {
  type AdminUpdateDomain,
  type AvailabilityQuery,
  type AvailabilityResult,
  type CreateDomainContactHandle,
  type CreateTld,
  DOMAIN_STATUS_TRANSITIONS,
  type Domain,
  type DomainAlert,
  type DomainContactHandle,
  type DomainContacts,
  type DomainListQuery,
  type DomainStatus,
  type DomainSyncLogEntry,
  type Paginated,
  type PaginationQuery,
  type PublicTld,
  pageOffset,
  paginate,
  type RegisterDomainRequest,
  type RegistrarAccount,
  type RegistrarModuleInfo,
  splitDomainName,
  type Tld,
  type TldWithPrices,
  type TransferDomainRequest,
  type UpdateDomain,
  type UpdateDomainContactHandle,
  type UpdateTld,
  type UpsertRegistrarAccount,
} from '@provisia/shared';
import { enqueue } from '@provisia/worker/queues';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import {
  loadRegistrarConfig,
  maskConfig,
  maskValue,
  resolveRegistrar,
} from './registrar-context.js';

// ---------------------------------------------------------------------------------------------
// Registrar accounts
// ---------------------------------------------------------------------------------------------

export async function listRegistrarModules(
  db: Db,
  modules: ModuleRegistry,
): Promise<RegistrarModuleInfo[]> {
  const rows = await db
    .select({ module: registrarAccounts.module, enabled: registrarAccounts.enabled })
    .from(registrarAccounts);
  const configured = new Set(rows.filter((r) => r.enabled).map((r) => r.module));
  return modules.list('registrar').map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    configured: configured.has(r.id),
    capabilities: {
      contacts: typeof r.setContacts === 'function',
      lock: typeof r.setLock === 'function',
      pricing: typeof r.getTldPricing === 'function',
    },
  }));
}

function toRegistrarAccount(
  row: typeof registrarAccounts.$inferSelect,
  config: Record<string, unknown>,
): RegistrarAccount {
  return {
    id: row.id,
    module: row.module,
    name: row.name,
    enabled: row.enabled,
    config: maskConfig(config),
    pricingImportedAt: row.pricingImportedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRegistrarAccount(
  db: Db,
  modules: ModuleRegistry,
  module: string,
  appKey?: string,
): Promise<RegistrarAccount> {
  const registrar = modules.find('registrar', module);
  if (!registrar) throw notFound('Registrar module');
  const [row] = await db
    .select()
    .from(registrarAccounts)
    .where(eq(registrarAccounts.module, module));
  if (!row) throw notFound('Registrar account');
  const config = (await loadRegistrarConfig(db, registrar, appKey)) ?? {};
  return toRegistrarAccount(row, config);
}

export async function upsertRegistrarAccount(
  db: Db,
  modules: ModuleRegistry,
  module: string,
  input: UpsertRegistrarAccount,
  appKey?: string,
): Promise<RegistrarAccount> {
  const registrar: Registrar | undefined = modules.find('registrar', module);
  if (!registrar) throw notFound('Registrar module');
  const [existing] = await db
    .select()
    .from(registrarAccounts)
    .where(eq(registrarAccounts.module, module));
  const previous = existing ? ((await loadRegistrarConfig(db, registrar, appKey)) ?? {}) : {};

  // Masked values sent back from the UI keep the stored secret.
  const merged: Record<string, unknown> = { ...previous };
  for (const [k, v] of Object.entries(input.config)) {
    const prev = previous[k];
    if (typeof v === 'string' && typeof prev === 'string' && v === maskValue(prev)) continue;
    merged[k] = v;
  }
  const parsed = registrar.configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AppError(
      'validation_error',
      'Registrar config is invalid',
      400,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const values = {
    name: input.name ?? existing?.name ?? registrar.name,
    enabled: input.enabled ?? existing?.enabled ?? true,
    configEncrypted: encryptJson(parsed.data, appKey),
  };
  const [row] = existing
    ? await db
        .update(registrarAccounts)
        .set(values)
        .where(eq(registrarAccounts.id, existing.id))
        .returning()
    : await db
        .insert(registrarAccounts)
        .values({ module, ...values })
        .returning();
  if (!row) throw new Error('failed to save registrar account');
  return toRegistrarAccount(row, parsed.data as Record<string, unknown>);
}

export async function deleteRegistrarAccount(db: Db, module: string): Promise<void> {
  const res = await db
    .delete(registrarAccounts)
    .where(eq(registrarAccounts.module, module))
    .returning({ id: registrarAccounts.id });
  if (!res.length) throw notFound('Registrar account');
}

// ---------------------------------------------------------------------------------------------
// TLD catalog
// ---------------------------------------------------------------------------------------------

type TldRow = typeof tlds.$inferSelect;
type TldPriceRow = typeof tldPrices.$inferSelect;

function toTld(row: TldRow): Tld {
  return { ...row, additionalFields: row.additionalFields ?? [] };
}

async function attachPrices(db: Db, rows: TldRow[]): Promise<TldWithPrices[]> {
  if (!rows.length) return [];
  const prices = await db
    .select()
    .from(tldPrices)
    .where(
      inArray(
        tldPrices.tldId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(tldPrices.years));
  const byTld = new Map<string, TldPriceRow[]>();
  for (const p of prices) {
    const list = byTld.get(p.tldId) ?? [];
    list.push(p);
    byTld.set(p.tldId, list);
  }
  return rows.map((r) => ({ ...toTld(r), prices: byTld.get(r.id) ?? [] }));
}

export interface TldListFilter {
  enabled?: boolean;
  registrarModule?: string;
  search?: string;
}

export async function listTlds(
  db: Db,
  filter: TldListFilter,
  q: PaginationQuery,
): Promise<Paginated<TldWithPrices>> {
  const where: SQL[] = [];
  if (filter.enabled !== undefined) where.push(eq(tlds.enabled, filter.enabled));
  if (filter.registrarModule) where.push(eq(tlds.registrarModule, filter.registrarModule));
  if (filter.search) where.push(ilike(tlds.tld, `%${filter.search.replace(/^\./, '')}%`));
  const cond = where.length ? and(...where) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(tlds)
      .where(cond)
      .orderBy(desc(tlds.featured), asc(tlds.sortOrder), asc(tlds.tld))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: sql<number>`count(*)::int` }).from(tlds).where(cond),
  ]);
  return paginate(await attachPrices(db, rows), count?.n ?? 0, q);
}

export async function getTld(db: Db, id: string): Promise<TldWithPrices> {
  const [row] = await db.select().from(tlds).where(eq(tlds.id, id));
  if (!row) throw notFound('TLD');
  const [withPrices] = await attachPrices(db, [row]);
  if (!withPrices) throw notFound('TLD');
  return withPrices;
}

export async function findTldByName(db: Db, tld: string): Promise<TldWithPrices | null> {
  const [row] = await db.select().from(tlds).where(eq(tlds.tld, tld.toLowerCase()));
  if (!row) return null;
  return (await attachPrices(db, [row]))[0] ?? null;
}

export async function createTld(db: Db, input: CreateTld): Promise<TldWithPrices> {
  const { prices, ...rest } = input;
  if (rest.minYears > rest.maxYears) throw badRequest('minYears must be <= maxYears');
  const [existing] = await db.select({ id: tlds.id }).from(tlds).where(eq(tlds.tld, rest.tld));
  if (existing) throw conflict(`TLD .${rest.tld} already exists`);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(tlds).values(rest).returning();
    if (!row) throw new Error('failed to create tld');
    if (prices.length)
      await tx.insert(tldPrices).values(prices.map((p) => ({ ...p, tldId: row.id })));
    const [out] = await attachPrices(tx as unknown as Db, [row]);
    return out as TldWithPrices;
  });
}

export async function updateTld(db: Db, id: string, input: UpdateTld): Promise<TldWithPrices> {
  const { prices, ...rest } = input;
  return db.transaction(async (tx) => {
    const [row] = Object.keys(rest).length
      ? await tx.update(tlds).set(rest).where(eq(tlds.id, id)).returning()
      : await tx.select().from(tlds).where(eq(tlds.id, id));
    if (!row) throw notFound('TLD');
    if (row.minYears > row.maxYears) throw badRequest('minYears must be <= maxYears');
    if (prices) {
      // Replace the sell prices; keep imported cost columns for rows with the same (years, currency).
      const old = await tx.select().from(tldPrices).where(eq(tldPrices.tldId, id));
      await tx.delete(tldPrices).where(eq(tldPrices.tldId, id));
      if (prices.length) {
        await tx.insert(tldPrices).values(
          prices.map((p) => {
            const prev = old.find((o) => o.years === p.years && o.currency === p.currency);
            return {
              ...p,
              tldId: id,
              costRegister: prev?.costRegister ?? null,
              costRenew: prev?.costRenew ?? null,
              costTransfer: prev?.costTransfer ?? null,
            };
          }),
        );
      }
    }
    const [out] = await attachPrices(tx as unknown as Db, [row]);
    return out as TldWithPrices;
  });
}

export async function deleteTld(db: Db, id: string): Promise<void> {
  const res = await db.delete(tlds).where(eq(tlds.id, id)).returning({ id: tlds.id });
  if (!res.length) throw notFound('TLD');
}

export async function listPublicTlds(db: Db): Promise<PublicTld[]> {
  const rows = await db
    .select()
    .from(tlds)
    .where(eq(tlds.enabled, true))
    .orderBy(desc(tlds.featured), asc(tlds.sortOrder), asc(tlds.tld));
  return (await attachPrices(db, rows)).map((t) => ({
    tld: t.tld,
    featured: t.featured,
    currency: t.currency,
    minYears: t.minYears,
    maxYears: t.maxYears,
    eppRequired: t.eppRequired,
    idProtectionSupported: t.idProtectionSupported,
    additionalFields: t.additionalFields,
    prices: t.prices.map((p) => ({
      years: p.years,
      currency: p.currency,
      register: p.register,
      renew: p.renew,
      transfer: p.transfer,
    })),
  }));
}

export type PriceKind = 'register' | 'renew' | 'transfer';

/**
 * Sell price for `years` of `kind`. Exact (years, currency) row wins; otherwise the 1-year row × years.
 * Returns null when the TLD has no usable price.
 */
export function priceForYears(
  tld: TldWithPrices,
  kind: PriceKind,
  years: number,
  currency = tld.currency,
): { amount: number; perYear: number } | null {
  const exact = tld.prices.find((p) => p.years === years && p.currency === currency);
  if (exact) return { amount: exact[kind], perYear: Math.round(exact[kind] / years) };
  const one = tld.prices.find((p) => p.years === 1 && p.currency === currency);
  if (one) return { amount: one[kind] * years, perYear: one[kind] };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Contact handles
// ---------------------------------------------------------------------------------------------

export async function listContactHandles(
  db: Db,
  clientId?: string,
): Promise<DomainContactHandle[]> {
  return db
    .select()
    .from(domainContacts)
    .where(clientId ? eq(domainContacts.clientId, clientId) : undefined)
    .orderBy(desc(domainContacts.isDefault), asc(domainContacts.label));
}

export async function getContactHandle(
  db: Db,
  id: string,
  clientId?: string,
): Promise<DomainContactHandle> {
  const [row] = await db
    .select()
    .from(domainContacts)
    .where(
      clientId
        ? and(eq(domainContacts.id, id), eq(domainContacts.clientId, clientId))
        : eq(domainContacts.id, id),
    );
  if (!row) throw notFound('Contact');
  return row;
}

export async function createContactHandle(
  db: Db,
  clientId: string,
  input: Omit<CreateDomainContactHandle, 'clientId'>,
): Promise<DomainContactHandle> {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(domainContacts)
        .set({ isDefault: false })
        .where(eq(domainContacts.clientId, clientId));
    }
    const [row] = await tx
      .insert(domainContacts)
      .values({ ...input, clientId })
      .returning();
    if (!row) throw new Error('failed to create contact');
    return row;
  });
}

export async function updateContactHandle(
  db: Db,
  id: string,
  input: UpdateDomainContactHandle,
  clientId?: string,
): Promise<DomainContactHandle> {
  const existing = await getContactHandle(db, id, clientId);
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(domainContacts)
        .set({ isDefault: false })
        .where(eq(domainContacts.clientId, existing.clientId));
    }
    const [row] = await tx
      .update(domainContacts)
      .set(input)
      .where(eq(domainContacts.id, id))
      .returning();
    return row ?? existing;
  });
}

export async function deleteContactHandle(db: Db, id: string, clientId?: string): Promise<void> {
  await getContactHandle(db, id, clientId);
  await db.delete(domainContacts).where(eq(domainContacts.id, id));
}

export function handleToContact(h: DomainContactHandle): DomainContacts['registrant'] {
  return {
    firstName: h.firstName,
    lastName: h.lastName,
    email: h.email,
    phone: h.phone,
    address1: h.address1,
    city: h.city,
    postalCode: h.postalCode,
    country: h.country,
    ...(h.organization ? { organization: h.organization } : {}),
    ...(h.address2 ? { address2: h.address2 } : {}),
    ...(h.state ? { state: h.state } : {}),
  };
}

/** Resolves contacts for a registration: inline > handle id > client's default handle. */
export async function resolveContacts(
  db: Db,
  clientId: string,
  input: { contacts?: DomainContacts; registrantContactId?: string },
): Promise<{ contacts: DomainContacts; registrantContactId: string | null }> {
  if (input.contacts)
    return { contacts: input.contacts, registrantContactId: input.registrantContactId ?? null };
  const handle = input.registrantContactId
    ? await getContactHandle(db, input.registrantContactId, clientId)
    : (await listContactHandles(db, clientId))[0];
  if (!handle) {
    throw new AppError(
      'domain_contact_required',
      'A registrant contact is required: pass `contacts` or create a contact handle first',
      400,
    );
  }
  return { contacts: { registrant: handleToContact(handle) }, registrantContactId: handle.id };
}

// ---------------------------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------------------------

type DomainRow = typeof domains.$inferSelect;

export function toDomain(row: DomainRow): Domain {
  const { eppCodeEncrypted: _omit, ...rest } = row;
  return { ...rest, contacts: rest.contacts ?? null };
}

export async function listDomains(
  db: Db,
  filter: DomainListQuery,
  q: PaginationQuery,
): Promise<Paginated<Domain>> {
  const where: SQL[] = [];
  if (filter.clientId) where.push(eq(domains.clientId, filter.clientId));
  if (filter.status) where.push(eq(domains.status, filter.status));
  if (filter.tld) where.push(eq(domains.tld, filter.tld.toLowerCase().replace(/^\./, '')));
  if (filter.registrarModule) where.push(eq(domains.registrarModule, filter.registrarModule));
  if (filter.search) where.push(ilike(domains.name, `%${filter.search.toLowerCase()}%`));
  if (filter.expiringBefore) where.push(lte(domains.expiryDate, filter.expiringBefore));
  const cond = where.length ? and(...where) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(domains)
      .where(cond)
      .orderBy(asc(domains.expiryDate), asc(domains.name))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: sql<number>`count(*)::int` }).from(domains).where(cond),
  ]);
  return paginate(rows.map(toDomain), count?.n ?? 0, q);
}

export async function getDomainRow(db: Db, id: string, clientId?: string): Promise<DomainRow> {
  const [row] = await db
    .select()
    .from(domains)
    .where(clientId ? and(eq(domains.id, id), eq(domains.clientId, clientId)) : eq(domains.id, id));
  if (!row) throw notFound('Domain');
  return row;
}

export async function getDomain(db: Db, id: string, clientId?: string): Promise<Domain> {
  return toDomain(await getDomainRow(db, id, clientId));
}

export function assertTransition(from: DomainStatus, to: DomainStatus, force = false): void {
  if (from === to || force) return;
  if (!DOMAIN_STATUS_TRANSITIONS[from].includes(to)) {
    throw new AppError(
      'invalid_status_transition',
      `Cannot move a domain from "${from}" to "${to}"`,
      409,
      { from, to, allowed: DOMAIN_STATUS_TRANSITIONS[from] },
    );
  }
}

export interface UpdateDomainResult {
  domain: Domain;
  /** Registrar-side changes pushed asynchronously by `domains:sync`. */
  job: { queue: 'domains'; name: string; id: string } | null;
  diff: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Updates local fields and, when a registrar is attached, enqueues a `sync` job that pushes
 * nameservers / contacts / lock to the registrar. Lock changes on a registrar without `setLock`
 * are rejected with `registrar_unsupported`.
 */
export async function updateDomain(
  db: Db,
  modules: ModuleRegistry,
  id: string,
  input: UpdateDomain | AdminUpdateDomain,
  opts: { clientId?: string; admin?: boolean } = {},
): Promise<UpdateDomainResult> {
  const row = await getDomainRow(db, id, opts.clientId);
  const admin = opts.admin ?? false;
  const { force, ...patch } = input as AdminUpdateDomain;
  const registrar = row.registrarModule
    ? modules.find('registrar', row.registrarModule)
    : undefined;

  if (
    patch.locked !== undefined &&
    patch.locked !== row.locked &&
    registrar &&
    !registrar.setLock
  ) {
    throw new AppError(
      'registrar_unsupported',
      `Registrar "${registrar.id}" does not support changing the transfer lock`,
      409,
    );
  }
  if (patch.status && patch.status !== row.status)
    assertTransition(row.status, patch.status, force);

  if (patch.registrantContactId) {
    const h = await getContactHandle(db, patch.registrantContactId, opts.clientId ?? row.clientId);
    patch.contacts = {
      ...(row.contacts ?? patch.contacts ?? { registrant: handleToContact(h) }),
      registrant: handleToContact(h),
    };
  }

  const diff: UpdateDomainResult['diff'] = {};
  const set: Partial<DomainRow> = {};
  for (const [k, v] of Object.entries(patch) as Array<[keyof DomainRow, unknown]>) {
    if (v === undefined) continue;
    if (JSON.stringify(row[k]) === JSON.stringify(v)) continue;
    (set as Record<string, unknown>)[k] = v;
    diff[k] = { before: row[k], after: v };
  }
  if (!admin) {
    // Portal may never touch these even if the schema let them through.
    for (const k of [
      'status',
      'registrarModule',
      'registrationDate',
      'expiryDate',
      'nextDueDate',
      'registrationPeriod',
      'recurringAmount',
      'notes',
    ] as const) {
      delete (set as Record<string, unknown>)[k];
      delete diff[k];
    }
  }

  const push: Array<'nameservers' | 'contacts' | 'lock' | 'idProtection'> = [];
  if ('nameservers' in set) push.push('nameservers');
  if ('contacts' in set) push.push('contacts');
  if ('locked' in set) push.push('lock');
  if ('idProtection' in set) push.push('idProtection');

  if (Object.keys(set).length === 0) return { domain: toDomain(row), job: null, diff };
  const [updated] = await db.update(domains).set(set).where(eq(domains.id, id)).returning();
  if (!updated) throw notFound('Domain');

  let job: UpdateDomainResult['job'] = null;
  if (push.length && registrar && updated.status !== 'pending') {
    const j = await enqueue(
      'domains',
      'sync',
      { domainId: id, push },
      { jobId: `domain:${id}:push:${Date.now()}` },
    );
    job = { queue: 'domains', name: 'sync', id: String(j.id) };
  }
  return { domain: toDomain(updated), job, diff };
}

export async function setDomainStatus(
  db: Db,
  id: string,
  status: DomainStatus,
  opts: { force?: boolean; reason?: string } = {},
): Promise<Domain> {
  const row = await getDomainRow(db, id);
  assertTransition(row.status, status, opts.force);
  const [updated] = await db.update(domains).set({ status }).where(eq(domains.id, id)).returning();
  await db.insert(domainSyncLog).values({
    domainId: id,
    job: 'manual',
    status: 'ok',
    transition: `${row.status} -> ${status}`,
    message: opts.reason ?? 'status set by admin',
  });
  return toDomain(updated ?? row);
}

export async function changeRegistrar(
  db: Db,
  modules: ModuleRegistry,
  id: string,
  registrarModule: string | null,
): Promise<Domain> {
  if (registrarModule && !modules.find('registrar', registrarModule)) {
    throw new AppError(
      'registrar_not_installed',
      `Registrar module "${registrarModule}" is not installed`,
      409,
    );
  }
  const row = await getDomainRow(db, id);
  const [updated] = await db
    .update(domains)
    .set({ registrarModule, moduleData: {}, lastError: null })
    .where(eq(domains.id, id))
    .returning();
  await db.insert(domainSyncLog).values({
    domainId: id,
    job: 'manual',
    status: 'ok',
    message: `registrar changed from ${row.registrarModule ?? 'none'} to ${registrarModule ?? 'none'}`,
  });
  return toDomain(updated ?? row);
}

type JobRef = { queue: 'domains'; name: string; id: string };

/** Resolves which registrar handles a TLD: explicit override > TLD catalog. */
async function registrarForTld(
  db: Db,
  tld: string,
  override?: string,
): Promise<{ tld: TldWithPrices; module: string }> {
  const catalog = await findTldByName(db, tld);
  if (!catalog?.enabled) {
    throw new AppError('tld_not_offered', `TLD .${tld} is not offered`, 400);
  }
  const module = override ?? catalog.registrarModule;
  if (!module) {
    throw new AppError('tld_has_no_registrar', `TLD .${tld} has no registrar module assigned`, 409);
  }
  return { tld: catalog, module };
}

async function insertPendingDomain(
  db: Db,
  input: RegisterDomainRequest | TransferDomainRequest,
  clientId: string,
  kind: 'register' | 'transfer',
): Promise<DomainRow> {
  const known = (await db.select({ tld: tlds.tld }).from(tlds)).map((t) => t.tld);
  const { tld } = splitDomainName(input.domain, known);
  const { tld: catalog, module } = await registrarForTld(db, tld, input.registrarModule);
  if (input.years < catalog.minYears || input.years > catalog.maxYears) {
    throw badRequest(`.${tld} can be registered for ${catalog.minYears}-${catalog.maxYears} years`);
  }
  if (kind === 'transfer' && catalog.eppRequired && !('eppCode' in input && input.eppCode)) {
    throw badRequest(`.${tld} transfers require an EPP code`);
  }
  const [dupe] = await db
    .select({ id: domains.id, status: domains.status })
    .from(domains)
    .where(eq(domains.name, input.domain));
  if (dupe && !['cancelled', 'transferred_away'].includes(dupe.status)) {
    throw conflict(`Domain ${input.domain} already exists`, { domainId: dupe.id });
  }
  const { contacts, registrantContactId } = await resolveContacts(db, clientId, input);
  const price = priceForYears(catalog, kind, input.years);
  const renewPrice = priceForYears(catalog, 'renew', 1);
  const values: typeof domains.$inferInsert = {
    clientId,
    name: input.domain,
    tld,
    registrarModule: module,
    status: 'pending',
    registrationPeriod: input.years,
    recurringAmount: renewPrice?.perYear ?? price?.perYear ?? 0,
    currency: catalog.currency,
    nameservers: input.nameservers ?? [],
    autoRenew: input.autoRenew,
    idProtection: input.idProtection,
    contacts,
    registrantContactId,
    moduleData: { additionalFields: input.additionalFields, kind },
  };
  if (dupe) {
    const [row] = await db
      .update(domains)
      .set({ ...values, lastError: null, expiryNoticesSent: [] })
      .where(eq(domains.id, dupe.id))
      .returning();
    if (!row) throw new Error('failed to reuse domain row');
    return row;
  }
  const [row] = await db.insert(domains).values(values).returning();
  if (!row) throw new Error('failed to create domain');
  return row;
}

/** Creates the domain row (`pending`) and enqueues `domains:register`. */
export async function startRegistration(
  db: Db,
  input: RegisterDomainRequest,
  clientId: string,
): Promise<{ domain: Domain; job: JobRef }> {
  const row = await insertPendingDomain(db, input, clientId, 'register');
  const j = await enqueue(
    'domains',
    'register',
    { domainId: row.id },
    { jobId: `domain:${row.id}:register` },
  );
  return { domain: toDomain(row), job: { queue: 'domains', name: 'register', id: String(j.id) } };
}

/** Creates the domain row (`pending`), stores the EPP code encrypted and enqueues `domains:transfer`. */
export async function startTransfer(
  db: Db,
  input: TransferDomainRequest,
  clientId: string,
  appKey?: string,
): Promise<{ domain: Domain; job: JobRef }> {
  const row = await insertPendingDomain(db, input, clientId, 'transfer');
  const { encrypt } = await import('@provisia/module-sdk');
  await db
    .update(domains)
    .set({ eppCodeEncrypted: encrypt(input.eppCode, appKey) })
    .where(eq(domains.id, row.id));
  const j = await enqueue(
    'domains',
    'transfer',
    { domainId: row.id },
    { jobId: `domain:${row.id}:transfer` },
  );
  return { domain: toDomain(row), job: { queue: 'domains', name: 'transfer', id: String(j.id) } };
}

export async function startRenewal(
  db: Db,
  id: string,
  years: number,
  opts: { clientId?: string } = {},
): Promise<{ domain: Domain; job: JobRef }> {
  const row = await getDomainRow(db, id, opts.clientId);
  if (!['active', 'expired'].includes(row.status)) {
    throw new AppError(
      'invalid_status_transition',
      `Only active or expired domains can be renewed (status: ${row.status})`,
      409,
    );
  }
  if (!row.registrarModule)
    throw new AppError('tld_has_no_registrar', 'Domain has no registrar module', 409);
  const catalog = await findTldByName(db, row.tld);
  if (catalog && (years < catalog.minYears || years > catalog.maxYears)) {
    throw badRequest(
      `.${row.tld} can be renewed for ${catalog.minYears}-${catalog.maxYears} years`,
    );
  }
  const j = await enqueue(
    'domains',
    'renew',
    { domainId: id, years },
    { jobId: `domain:${id}:renew:${row.expiryDate ?? 'na'}` },
  );
  return { domain: toDomain(row), job: { queue: 'domains', name: 'renew', id: String(j.id) } };
}

export async function requestSync(db: Db, id: string): Promise<JobRef> {
  const row = await getDomainRow(db, id);
  if (!row.registrarModule)
    throw new AppError('tld_has_no_registrar', 'Domain has no registrar module', 409);
  const j = await enqueue(
    'domains',
    'sync',
    { domainId: id },
    { jobId: `domain:${id}:sync:${Date.now()}` },
  );
  return { queue: 'domains', name: 'sync', id: String(j.id) };
}

export const EPP_CODE_MAX_AGE_DAYS = 30;

/**
 * Returns the stored EPP code when it is fresh; otherwise enqueues `domains:fetchEppCode` and
 * returns `eppCode: null` with the job id (poll the endpoint again).
 */
export async function requestEppCode(
  db: Db,
  id: string,
  opts: { clientId?: string; appKey?: string } = {},
): Promise<{
  domain: string;
  eppCode: string | null;
  fetchedAt: Date | null;
  job: { id: string } | null;
}> {
  const row = await getDomainRow(db, id, opts.clientId);
  if (row.status !== 'active') {
    throw new AppError(
      'invalid_status_transition',
      'EPP codes are only available for active domains',
      409,
    );
  }
  const fetchedAtRaw = row.moduleData.eppFetchedAt;
  const fetchedAt = typeof fetchedAtRaw === 'string' ? new Date(fetchedAtRaw) : null;
  const fresh = fetchedAt && Date.now() - fetchedAt.getTime() < EPP_CODE_MAX_AGE_DAYS * 86_400_000;
  if (row.eppCodeEncrypted && fresh) {
    return {
      domain: row.name,
      eppCode: decrypt(row.eppCodeEncrypted, opts.appKey),
      fetchedAt,
      job: null,
    };
  }
  if (!row.registrarModule) {
    if (row.eppCodeEncrypted) {
      return {
        domain: row.name,
        eppCode: decrypt(row.eppCodeEncrypted, opts.appKey),
        fetchedAt,
        job: null,
      };
    }
    throw new AppError(
      'tld_has_no_registrar',
      'Domain has no registrar module; ask support for the EPP code',
      409,
    );
  }
  const j = await enqueue(
    'domains',
    'fetchEppCode',
    { domainId: id },
    { jobId: `domain:${id}:epp:${Date.now()}` },
  );
  return { domain: row.name, eppCode: null, fetchedAt, job: { id: String(j.id) } };
}

export async function requestPricingImport(
  db: Db,
  modules: ModuleRegistry,
  input: {
    registrarModule: string;
    markupPercent: number;
    createMissing: boolean;
    overwriteSellPrices: boolean;
  },
): Promise<JobRef> {
  const registrar = modules.find('registrar', input.registrarModule);
  if (!registrar) throw notFound('Registrar module');
  if (!registrar.getTldPricing) {
    throw new AppError(
      'registrar_unsupported',
      `Registrar "${registrar.id}" does not publish TLD pricing`,
      409,
    );
  }
  const [account] = await db
    .select({ id: registrarAccounts.id })
    .from(registrarAccounts)
    .where(and(eq(registrarAccounts.module, registrar.id), eq(registrarAccounts.enabled, true)));
  if (!account)
    throw new AppError(
      'registrar_not_configured',
      `Registrar "${registrar.id}" is not configured`,
      409,
    );
  const j = await enqueue('domains', 'importPricing', input, {
    jobId: `pricing:${registrar.id}:${Date.now()}`,
  });
  return { queue: 'domains', name: 'importPricing', id: String(j.id) };
}

// ---------------------------------------------------------------------------------------------
// Sync log & alerts
// ---------------------------------------------------------------------------------------------

export async function listSyncLog(
  db: Db,
  domainId: string,
  q: PaginationQuery,
): Promise<Paginated<DomainSyncLogEntry>> {
  const cond = eq(domainSyncLog.domainId, domainId);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(domainSyncLog)
      .where(cond)
      .orderBy(desc(domainSyncLog.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: sql<number>`count(*)::int` }).from(domainSyncLog).where(cond),
  ]);
  return paginate(rows as DomainSyncLogEntry[], count?.n ?? 0, q);
}

export async function listAlerts(
  db: Db,
  filter: { acknowledged: boolean; domainId?: string },
  q: PaginationQuery,
): Promise<Paginated<DomainAlert>> {
  const where: SQL[] = [
    filter.acknowledged
      ? gte(domainAlerts.acknowledgedAt, new Date(0))
      : isNull(domainAlerts.acknowledgedAt),
  ];
  if (filter.domainId) where.push(eq(domainAlerts.domainId, filter.domainId));
  const cond = and(...where);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(domainAlerts)
      .where(cond)
      .orderBy(desc(domainAlerts.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: sql<number>`count(*)::int` }).from(domainAlerts).where(cond),
  ]);
  return paginate(rows as DomainAlert[], count?.n ?? 0, q);
}

export async function acknowledgeAlert(db: Db, id: string, userId: string): Promise<DomainAlert> {
  const [row] = await db
    .update(domainAlerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
    .where(eq(domainAlerts.id, id))
    .returning();
  if (!row) throw notFound('Alert');
  return row as DomainAlert;
}

// ---------------------------------------------------------------------------------------------
// Availability (the only registrar call allowed inline in HTTP)
// ---------------------------------------------------------------------------------------------

export interface AvailabilityDeps {
  db: Db;
  modules: ModuleRegistry;
  redis?: Redis | null;
  appKey?: string;
  appUrl: string;
  webUrl: string;
  logger: ModuleLogger;
}

export const AVAILABILITY_CACHE_TTL = 120;
const CACHE_PREFIX = 'domains:availability:';

async function cacheGet(
  redis: Redis | null | undefined,
  name: string,
): Promise<AvailabilityResult | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(CACHE_PREFIX + name);
    return raw ? (JSON.parse(raw) as AvailabilityResult) : null;
  } catch {
    return null;
  }
}

async function cacheSet(redis: Redis | null | undefined, r: AvailabilityResult): Promise<void> {
  if (!redis || r.status === 'unknown') return;
  try {
    await redis.set(CACHE_PREFIX + r.domain, JSON.stringify(r), 'EX', AVAILABILITY_CACHE_TTL);
  } catch {
    /* cache is best effort */
  }
}

function catalogPrice(t: TldWithPrices): AvailabilityResult['price'] {
  const p = priceForYears(t, 'register', t.minYears);
  return p ? { amount: p.amount, currency: t.currency, years: t.minYears } : null;
}

export async function checkAvailability(
  deps: AvailabilityDeps,
  q: AvailabilityQuery,
): Promise<{
  requested: AvailabilityResult | null;
  suggestions: AvailabilityResult[];
  ttl: number;
}> {
  const catalog = (await listPublicTldRows(deps.db)).filter((t) => t.enabled);
  const known = catalog.map((t) => t.tld);
  const byTld = new Map(catalog.map((t) => [t.tld, t]));

  // Build the candidate list: requested name first, then suggestions on other TLDs.
  let sld: string;
  let requestedName: string | null = null;
  if (q.domain) {
    const parts = splitDomainName(q.domain, known);
    sld = parts.sld;
    requestedName = q.domain;
  } else {
    sld = q.sld as string;
  }
  const wanted = (q.tlds?.length ? q.tlds : known).map((t) => t.toLowerCase().replace(/^\./, ''));
  const names: string[] = [];
  if (requestedName) names.push(requestedName);
  if (!requestedName || q.suggestions) {
    for (const t of wanted) {
      const n = `${sld}.${t}`;
      if (
        n !== requestedName &&
        !names.includes(n) &&
        names.length < q.limit + (requestedName ? 1 : 0)
      )
        names.push(n);
    }
  }

  // Local knowledge first: a name we manage is taken, an unknown TLD cannot be checked.
  const managed = new Set(
    (
      await deps.db.select({ name: domains.name }).from(domains).where(inArray(domains.name, names))
    ).map((d) => d.name),
  );
  const results = new Map<string, AvailabilityResult>();
  const toCheck = new Map<string, string[]>(); // module -> names
  for (const name of names) {
    const { tld } = splitDomainName(name, known);
    const t = byTld.get(tld);
    const base = { domain: name, tld, premium: false, price: t ? catalogPrice(t) : null };
    if (!t) {
      results.set(name, {
        ...base,
        status: 'unknown',
        available: false,
        reason: 'tld_not_offered',
      });
      continue;
    }
    if (managed.has(name)) {
      results.set(name, { ...base, status: 'taken', available: false, reason: 'managed_here' });
      continue;
    }
    const cached = await cacheGet(deps.redis, name);
    if (cached) {
      results.set(name, cached);
      continue;
    }
    if (!t.registrarModule) {
      results.set(name, { ...base, status: 'unknown', available: false, reason: 'no_registrar' });
      continue;
    }
    toCheck.set(t.registrarModule, [...(toCheck.get(t.registrarModule) ?? []), name]);
  }

  await Promise.all(
    [...toCheck.entries()].map(async ([module, list]) => {
      try {
        const { registrar, ctx } = await resolveRegistrar({ ...deps, module });
        const remote = await registrar.checkAvailability(ctx, list);
        for (const r of remote) {
          const { tld } = splitDomainName(r.domain, known);
          const t = byTld.get(tld);
          const out: AvailabilityResult = {
            domain: r.domain,
            tld,
            status: r.reason && !r.available ? 'unknown' : r.available ? 'available' : 'taken',
            available: r.available,
            premium: Boolean(r.premium),
            price: r.price
              ? { amount: r.price.amount, currency: r.price.currency, years: t?.minYears ?? 1 }
              : t
                ? catalogPrice(t)
                : null,
            ...(r.reason ? { reason: r.reason } : {}),
          };
          results.set(r.domain, out);
          await cacheSet(deps.redis, out);
        }
      } catch (err) {
        deps.logger.warn(
          { module, err: err instanceof Error ? err.message : String(err) },
          'availability check failed',
        );
        for (const name of list) {
          const { tld } = splitDomainName(name, known);
          const t = byTld.get(tld);
          results.set(name, {
            domain: name,
            tld,
            status: 'unknown',
            available: false,
            premium: false,
            price: t ? catalogPrice(t) : null,
            reason: err instanceof AppError ? err.code : 'registrar_error',
          });
        }
      }
    }),
  );

  const ordered = names
    .map((n) => results.get(n))
    .filter((r): r is AvailabilityResult => Boolean(r));
  const requested = requestedName
    ? (ordered.find((r) => r.domain === requestedName) ?? null)
    : null;
  return {
    requested,
    suggestions: ordered.filter((r) => r.domain !== requestedName),
    ttl: AVAILABILITY_CACHE_TTL,
  };
}

async function listPublicTldRows(db: Db): Promise<TldWithPrices[]> {
  const rows = await db
    .select()
    .from(tlds)
    .orderBy(desc(tlds.featured), asc(tlds.sortOrder), asc(tlds.tld));
  return attachPrices(db, rows);
}

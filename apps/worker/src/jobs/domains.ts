/**
 * Domain worker jobs. Every registrar call in the system (except availability) happens here.
 * Each run writes `domain_sync_log`; failures also raise a `domain_alerts` row for the admin.
 * State machine: apps/api/src/modules/domains/README.md.
 */
import {
  clients,
  type Db,
  domainAlerts,
  domainSyncLog,
  domains,
  registrarAccounts,
  tldPrices,
  tlds,
  users,
} from '@provisia/db';
import {
  createModuleContext,
  type DomainDTO,
  type DomainResult,
  decrypt,
  decryptJson,
  encrypt,
  type ModuleContext,
  ModuleRegistry,
  type Registrar,
  type TldPrice,
} from '@provisia/module-sdk';
import skrime from '@provisia/registrar-skrime';
import {
  DOMAIN_AUTO_RENEW_DAYS_BEFORE,
  DOMAIN_EXPIRY_NOTICE_DAYS,
  type DomainStatus,
  type EmailTemplateData,
  type EmailTemplateKey,
  roundHalfUp,
} from '@provisia/shared';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { JobContext, JobHandler } from '../context.js';
import { enqueue, getQueue, type JobData } from '../queues.js';

// ---------------------------------------------------------------------------------------------
// Module registry (worker side). Mirrors apps/api/src/modules/registry.ts for registrars.
// ---------------------------------------------------------------------------------------------

const registrars: Registrar[] = [skrime];
let registry: ModuleRegistry | undefined;
function modules(): ModuleRegistry {
  if (!registry) {
    registry = new ModuleRegistry();
    for (const r of registrars) registry.register('registrar', r);
  }
  return registry;
}

type DomainRow = typeof domains.$inferSelect;

class DomainJobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'DomainJobError';
  }
}

async function resolveRegistrar(
  ctx: JobContext,
  module: string,
): Promise<{ registrar: Registrar; mctx: ModuleContext }> {
  const registrar = modules().find('registrar', module);
  if (!registrar)
    throw new DomainJobError('registrar_not_installed', `registrar "${module}" is not installed`);
  const [row] = await ctx.db
    .select({
      configEncrypted: registrarAccounts.configEncrypted,
      enabled: registrarAccounts.enabled,
    })
    .from(registrarAccounts)
    .where(eq(registrarAccounts.module, module))
    .limit(1);
  if (!row?.enabled) {
    throw new DomainJobError(
      'registrar_not_configured',
      `registrar "${module}" is not configured or disabled`,
    );
  }
  const parsed = registrar.configSchema.safeParse(decryptJson(row.configEncrypted));
  if (!parsed.success)
    throw new DomainJobError('registrar_config_invalid', `registrar "${module}" config is invalid`);
  const mctx = createModuleContext({
    config: parsed.data,
    logger: ctx.logger,
    appUrl: ctx.appUrl,
    webUrl: ctx.webUrl,
  });
  return { registrar, mctx };
}

function toDto(row: DomainRow): DomainDTO {
  const { eppCodeEncrypted: _omit, ...rest } = row;
  return { ...rest, contacts: rest.contacts ?? null };
}

async function loadDomain(db: Db, id: string): Promise<DomainRow> {
  const [row] = await db.select().from(domains).where(eq(domains.id, id));
  if (!row) throw new DomainJobError('domain_not_found', `domain ${id} not found`);
  return row;
}

async function logSync(
  db: Db,
  entry: {
    domainId?: string | null;
    job: string;
    status: 'ok' | 'failed' | 'skipped';
    transition?: string | null;
    message?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await db.insert(domainSyncLog).values({
    domainId: entry.domainId ?? null,
    job: entry.job,
    status: entry.status,
    transition: entry.transition ?? null,
    message: entry.message ?? null,
    details: entry.details ?? null,
  });
}

async function raiseAlert(
  db: Db,
  alert: {
    domainId?: string | null;
    severity: 'info' | 'warning' | 'error';
    kind: string;
    title: string;
    message: string;
    details?: Record<string, unknown> | null;
  },
) {
  await db
    .insert(domainAlerts)
    .values({ ...alert, domainId: alert.domainId ?? null, details: alert.details ?? null });
}

function errorInfo(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof DomainJobError)
    return { code: err.code, message: err.message, retryable: err.retryable };
  const anyErr = err as { code?: unknown; message?: unknown; retryable?: unknown };
  return {
    code: typeof anyErr?.code === 'string' ? anyErr.code : 'error',
    message: err instanceof Error ? err.message : String(err),
    retryable: anyErr?.retryable === true,
  };
}

async function transition(
  db: Db,
  row: DomainRow,
  to: DomainStatus,
  job: string,
  set: Partial<typeof domains.$inferInsert> = {},
  message?: string,
) {
  const [updated] = await db
    .update(domains)
    .set({ ...set, status: to, lastError: null })
    .where(eq(domains.id, row.id))
    .returning();
  await logSync(db, {
    domainId: row.id,
    job,
    status: 'ok',
    transition: row.status === to ? null : `${row.status} -> ${to}`,
    message: message ?? null,
  });
  return updated ?? row;
}

/**
 * Records a failure: sync log + alert + `domains.last_error`. Retryable errors re-throw so BullMQ
 * retries (3x exponential); permanent ones return so the job completes and the admin is alerted.
 */
async function fail(
  ctx: JobContext,
  row: DomainRow | null,
  job: string,
  err: unknown,
  attemptsLeft: boolean,
): Promise<{ ok: false; code: string; message: string }> {
  const info = errorInfo(err);
  ctx.logger.error({ domainId: row?.id, job, err }, 'domain job failed');
  await logSync(ctx.db, {
    domainId: row?.id,
    job,
    status: 'failed',
    message: info.message,
    details: { code: info.code },
  });
  if (row)
    await ctx.db
      .update(domains)
      .set({ lastError: `${job}: ${info.message}` })
      .where(eq(domains.id, row.id));
  if (info.retryable && attemptsLeft) throw err;
  await raiseAlert(ctx.db, {
    domainId: row?.id,
    severity: 'error',
    kind: `${job}_failed`,
    title: `Domain ${job} failed${row ? `: ${row.name}` : ''}`,
    message: info.message,
    details: { code: info.code },
  });
  return { ok: false, code: info.code, message: info.message };
}

function hasAttemptsLeft(job: { attemptsMade: number; opts: { attempts?: number } }): boolean {
  return job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

function registerRequest(row: DomainRow) {
  if (!row.contacts)
    throw new DomainJobError('domain_contact_required', `domain ${row.name} has no contacts`);
  const additional = row.moduleData.additionalFields;
  return {
    domain: row.name,
    years: row.registrationPeriod,
    nameservers: row.nameservers,
    contacts: row.contacts,
    idProtection: row.idProtection,
    additionalFields:
      additional && typeof additional === 'object' ? (additional as Record<string, string>) : {},
  };
}

function applyResult(row: DomainRow, res: DomainResult): Partial<typeof domains.$inferInsert> {
  return {
    expiryDate: res.expiryDate ?? row.expiryDate,
    nextDueDate: res.expiryDate ?? row.nextDueDate,
    moduleData: { ...row.moduleData, ...(res.moduleData ?? {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// register / transfer / renew
// ---------------------------------------------------------------------------------------------

/** pending -> pending_registration (registrar accepted) -> active (sync or completed result). */
export const register: JobHandler<JobData<'domains', 'register'>> = async (ctx, data, job) => {
  const row = await loadDomain(ctx.db, data.domainId);
  if (!['pending', 'pending_registration'].includes(row.status)) {
    await logSync(ctx.db, {
      domainId: row.id,
      job: 'register',
      status: 'skipped',
      message: `status is ${row.status}`,
    });
    return { ok: true, skipped: true };
  }
  if (!row.registrarModule) {
    return fail(
      ctx,
      row,
      'register',
      new DomainJobError('tld_has_no_registrar', 'no registrar module'),
      false,
    );
  }
  try {
    const { registrar, mctx } = await resolveRegistrar(ctx, row.registrarModule);
    const res = await registrar.register(mctx, registerRequest(row));
    const today = new Date().toISOString().slice(0, 10);
    const set = { ...applyResult(row, res), registrationDate: row.registrationDate ?? today };
    const to: DomainStatus = res.status === 'completed' ? 'active' : 'pending_registration';
    const saved = await transition(ctx.db, row, to, 'register', set, res.message);
    if (to === 'active')
      await sendDomainEmail(ctx, saved, 'domain.registered', `domain:${row.id}:mail:registered`);
    if (to === 'pending_registration') {
      // Poll until the registrar confirms (daily sync also covers it).
      await getQueue('domains').add(
        'sync',
        { domainId: row.id },
        { jobId: `domain:${row.id}:sync:post-register`, delay: 10 * 60_000 },
      );
    }
    return { ok: true, status: to };
  } catch (err) {
    return fail(ctx, row, 'register', err, hasAttemptsLeft(job));
  }
};

/** pending -> pending_transfer (registrar accepted) -> active (sync). */
export const transfer: JobHandler<JobData<'domains', 'transfer'>> = async (ctx, data, job) => {
  const row = await loadDomain(ctx.db, data.domainId);
  if (!['pending', 'pending_transfer'].includes(row.status)) {
    await logSync(ctx.db, {
      domainId: row.id,
      job: 'transfer',
      status: 'skipped',
      message: `status is ${row.status}`,
    });
    return { ok: true, skipped: true };
  }
  if (!row.registrarModule) {
    return fail(
      ctx,
      row,
      'transfer',
      new DomainJobError('tld_has_no_registrar', 'no registrar module'),
      false,
    );
  }
  if (!row.eppCodeEncrypted) {
    return fail(
      ctx,
      row,
      'transfer',
      new DomainJobError('invalid_auth_code', 'no EPP code stored'),
      false,
    );
  }
  try {
    const { registrar, mctx } = await resolveRegistrar(ctx, row.registrarModule);
    const res = await registrar.transfer(mctx, {
      ...registerRequest(row),
      eppCode: decrypt(row.eppCodeEncrypted),
    });
    const to: DomainStatus = res.status === 'completed' ? 'active' : 'pending_transfer';
    const today = new Date().toISOString().slice(0, 10);
    await transition(
      ctx.db,
      row,
      to,
      'transfer',
      { ...applyResult(row, res), ...(to === 'active' ? { registrationDate: today } : {}) },
      res.message,
    );
    if (to === 'pending_transfer') {
      await sendDomainEmail(
        ctx,
        row,
        'domain.transfer_initiated',
        `domain:${row.id}:mail:transfer`,
      );
      await getQueue('domains').add(
        'sync',
        { domainId: row.id },
        { jobId: `domain:${row.id}:sync:post-transfer`, delay: 60 * 60_000 },
      );
    }
    return { ok: true, status: to };
  } catch (err) {
    return fail(ctx, row, 'transfer', err, hasAttemptsLeft(job));
  }
};

/** active|expired|redemption -> active with a new expiry. */
export const renew: JobHandler<JobData<'domains', 'renew'>> = async (ctx, data, job) => {
  const row = await loadDomain(ctx.db, data.domainId);
  if (!['active', 'expired', 'redemption'].includes(row.status)) {
    await logSync(ctx.db, {
      domainId: row.id,
      job: 'renew',
      status: 'skipped',
      message: `status is ${row.status}`,
    });
    return { ok: true, skipped: true };
  }
  if (!row.registrarModule) {
    return fail(
      ctx,
      row,
      'renew',
      new DomainJobError('tld_has_no_registrar', 'no registrar module'),
      false,
    );
  }
  try {
    const { registrar, mctx } = await resolveRegistrar(ctx, row.registrarModule);
    const res = await registrar.renew(mctx, toDto(row), data.years);
    const set = applyResult(row, res);
    const changed = res.expiryDate && res.expiryDate !== row.expiryDate;
    await transition(
      ctx.db,
      row,
      res.status === 'completed' ? 'active' : row.status,
      'renew',
      {
        ...set,
        // A new expiry resets the notice bookkeeping for the next cycle.
        ...(changed ? { expiryNoticesSent: [], autoRenewInvoicedAt: null } : {}),
      },
      res.message ?? `renewed ${data.years} year(s)`,
    );
    if (res.status === 'completed') {
      await sendDomainEmail(
        ctx,
        { ...row, ...set } as DomainRow,
        'domain.renewed',
        `domain:${row.id}:mail:renewed:${res.expiryDate ?? Date.now()}`,
      );
    } else {
      await getQueue('domains').add(
        'sync',
        { domainId: row.id },
        { jobId: `domain:${row.id}:sync:post-renew:${Date.now()}`, delay: 10 * 60_000 },
      );
    }
    return { ok: true, expiryDate: res.expiryDate ?? null };
  } catch (err) {
    return fail(ctx, row, 'renew', err, hasAttemptsLeft(job));
  }
};

// ---------------------------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------------------------

const SYNCABLE: DomainStatus[] = [
  'pending_registration',
  'pending_transfer',
  'active',
  'expired',
  'redemption',
];

/** Pushes pending local changes (nameservers/contacts/lock) and then refreshes expiry/status/nameservers. */
async function syncOne(
  ctx: JobContext,
  row: DomainRow,
  push: JobData<'domains', 'sync'>['push'] = [],
) {
  if (!row.registrarModule) {
    await logSync(ctx.db, {
      domainId: row.id,
      job: 'sync',
      status: 'skipped',
      message: 'no registrar module',
    });
    return { ok: true, skipped: true as const };
  }
  const { registrar, mctx } = await resolveRegistrar(ctx, row.registrarModule);
  const dto = toDto(row);

  for (const what of push) {
    if (what === 'nameservers') await registrar.setNameservers(mctx, dto, row.nameservers);
    else if (what === 'contacts' && row.contacts) {
      if (!registrar.setContacts)
        throw new DomainJobError('registrar_unsupported', 'registrar cannot update contacts');
      await registrar.setContacts(mctx, dto, row.contacts);
    } else if (what === 'lock') {
      if (!registrar.setLock)
        throw new DomainJobError('registrar_unsupported', 'registrar cannot change the lock');
      await registrar.setLock(mctx, dto, row.locked);
    } else if (what === 'idProtection') {
      ctx.logger.info(
        { domain: row.name },
        'idProtection change recorded locally; registrar push not supported by the SDK',
      );
    }
  }

  const info = await registrar.getInfo(mctx, dto);
  const today = new Date().toISOString().slice(0, 10);
  let to: DomainStatus = row.status;
  let note: string | undefined;
  switch (info.status) {
    case 'active':
      to = 'active';
      break;
    case 'expired':
      to = row.status === 'redemption' ? 'redemption' : 'expired';
      break;
    case 'pending':
      to = row.status === 'pending_transfer' ? 'pending_transfer' : 'pending_registration';
      break;
    case 'pending_transfer':
      to = 'pending_transfer';
      break;
    case 'transferred_away':
      to = 'transferred_away';
      break;
    case 'unknown':
      note = 'registrar does not know this domain';
      await raiseAlert(ctx.db, {
        domainId: row.id,
        severity: 'warning',
        kind: 'registrar_not_found',
        title: `Registrar has no record of ${row.name}`,
        message: `getInfo returned "unknown" for ${row.name} (${row.registrarModule}). Status left at ${row.status}; check the registrar panel.`,
      });
      break;
  }
  // Local expiry bookkeeping: expired + past grace/redemption windows.
  const expiry = info.expiryDate ?? row.expiryDate;
  if (to === 'active' && expiry && expiry < today) to = 'expired';
  if ((to === 'expired' || to === 'redemption') && expiry) {
    const [tld] = await ctx.db.select().from(tlds).where(eq(tlds.tld, row.tld));
    const grace = tld?.gracePeriodDays ?? 0;
    const redemption = tld?.redemptionPeriodDays ?? 30;
    const daysPast = Math.floor((Date.parse(today) - Date.parse(expiry)) / 86_400_000);
    if (daysPast > grace + redemption) to = 'cancelled';
    else if (daysPast > grace) to = 'redemption';
  }

  const set: Partial<typeof domains.$inferInsert> = {
    expiryDate: expiry,
    nextDueDate: info.expiryDate ?? row.nextDueDate,
    nameservers: info.nameservers.length ? info.nameservers : row.nameservers,
    locked: info.locked ?? row.locked,
    idProtection: info.idProtection ?? row.idProtection,
    registrarStatus: info.status,
    lastSyncedAt: new Date(),
    ...(info.expiryDate && info.expiryDate !== row.expiryDate
      ? { expiryNoticesSent: [], autoRenewInvoicedAt: null }
      : {}),
    ...(to === 'active' && !row.registrationDate ? { registrationDate: today } : {}),
  };
  const saved = await transition(
    ctx.db,
    row,
    to,
    'sync',
    set,
    note ?? (push.length ? `pushed ${push.join(', ')}` : undefined),
  );
  if (to === 'active' && ['pending_registration', 'pending_transfer'].includes(row.status)) {
    await sendDomainEmail(ctx, saved, 'domain.registered', `domain:${row.id}:mail:registered`);
  }
  return { ok: true as const, status: to, expiryDate: expiry };
}

/** With `domainId`: one domain. Without: daily sweep over every syncable domain with a registrar. */
export const sync: JobHandler<JobData<'domains', 'sync'>> = async (ctx, data, job) => {
  if (data.domainId) {
    const row = await loadDomain(ctx.db, data.domainId);
    try {
      return await syncOne(ctx, row, data.push);
    } catch (err) {
      return fail(ctx, row, 'sync', err, hasAttemptsLeft(job));
    }
  }
  const rows = await ctx.db
    .select()
    .from(domains)
    .where(and(inArray(domains.status, SYNCABLE), isNotNull(domains.registrarModule)));
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await syncOne(ctx, row);
      ok++;
    } catch (err) {
      failed++;
      await fail(ctx, row, 'sync', err, false);
    }
  }
  ctx.logger.info({ ok, failed, total: rows.length }, 'domain sync sweep done');
  return { ok: true, synced: ok, failed, total: rows.length };
};

// ---------------------------------------------------------------------------------------------
// fetchEppCode
// ---------------------------------------------------------------------------------------------

export const fetchEppCode: JobHandler<JobData<'domains', 'fetchEppCode'>> = async (
  ctx,
  data,
  job,
) => {
  const row = await loadDomain(ctx.db, data.domainId);
  if (!row.registrarModule) {
    return fail(
      ctx,
      row,
      'fetchEppCode',
      new DomainJobError('tld_has_no_registrar', 'no registrar module'),
      false,
    );
  }
  try {
    const { registrar, mctx } = await resolveRegistrar(ctx, row.registrarModule);
    const code = await registrar.getEppCode(mctx, toDto(row));
    await ctx.db
      .update(domains)
      .set({
        eppCodeEncrypted: encrypt(code),
        moduleData: { ...row.moduleData, eppFetchedAt: new Date().toISOString() },
        lastError: null,
      })
      .where(eq(domains.id, row.id));
    await logSync(ctx.db, {
      domainId: row.id,
      job: 'fetchEppCode',
      status: 'ok',
      message: 'EPP code fetched',
    });
    return { ok: true };
  } catch (err) {
    return fail(ctx, row, 'fetchEppCode', err, hasAttemptsLeft(job));
  }
};

// ---------------------------------------------------------------------------------------------
// expiryNotices (60/30/7/1 days) -> email queue
// ---------------------------------------------------------------------------------------------

async function clientRecipient(db: Db, clientId: string) {
  const [row] = await db
    .select({
      email: users.email,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      companyName: clients.companyName,
      language: clients.language,
    })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId));
  return row ?? null;
}

type DomainEmailKey =
  | 'domain.registered'
  | 'domain.transfer_initiated'
  | 'domain.expiring'
  | 'domain.renewed';

/** Enqueues a templated client email on the `email` queue (support agent's `send` job). */
async function sendDomainEmail<K extends DomainEmailKey>(
  ctx: JobContext,
  row: DomainRow,
  key: K,
  jobId: string,
  extra: Partial<EmailTemplateData[K]> = {},
): Promise<boolean> {
  const r = await clientRecipient(ctx.db, row.clientId);
  if (!r) return false;
  const data: EmailTemplateData[K] = {
    client: { firstName: r.firstName, lastName: r.lastName, companyName: r.companyName },
    domain: {
      id: row.id,
      name: row.name,
      expiryDate: row.expiryDate,
      registrationDate: row.registrationDate,
      years: row.registrationPeriod,
      nameservers: row.nameservers,
      autoRenew: row.autoRenew,
    },
    domainUrl: `${ctx.webUrl}/portal/domains/${row.id}`,
    ...extra,
  } as EmailTemplateData[K];
  await enqueue(
    'email',
    'send',
    {
      key: key as EmailTemplateKey,
      to: r.email,
      toName: `${r.firstName} ${r.lastName}`.trim(),
      toUserId: r.userId,
      locale: r.language,
      data: data as unknown as Record<string, unknown>,
    },
    { jobId },
  );
  return true;
}

export const expiryNotices: JobHandler<JobData<'domains', 'expiryNotices'>> = async (ctx) => {
  const today = new Date();
  const maxDays = Math.max(...DOMAIN_EXPIRY_NOTICE_DAYS);
  const horizon = new Date(today.getTime() + maxDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await ctx.db
    .select()
    .from(domains)
    .where(
      and(
        inArray(domains.status, ['active', 'expired']),
        isNotNull(domains.expiryDate),
        lte(domains.expiryDate, horizon),
      ),
    );
  let sent = 0;
  for (const row of rows) {
    if (!row.expiryDate) continue;
    const daysLeft = Math.ceil((Date.parse(row.expiryDate) - today.getTime()) / 86_400_000);
    // The largest threshold that is due and not yet sent for this expiry date.
    const due = DOMAIN_EXPIRY_NOTICE_DAYS.filter(
      (d) => daysLeft <= d && !row.expiryNoticesSent.includes(d),
    );
    const threshold = due.length ? Math.min(...due) : undefined;
    if (threshold === undefined) continue;
    try {
      const queued = await sendDomainEmail(
        ctx,
        row,
        'domain.expiring',
        `domain:${row.id}:expiry:${row.expiryDate}:${threshold}`,
        { daysLeft },
      );
      if (!queued) continue;
      await ctx.db
        .update(domains)
        .set({ expiryNoticesSent: [...row.expiryNoticesSent, ...due] })
        .where(eq(domains.id, row.id));
      await logSync(ctx.db, {
        domainId: row.id,
        job: 'expiryNotices',
        status: 'ok',
        message: `notice ${threshold}d queued`,
        details: { daysLeft },
      });
      sent++;
    } catch (err) {
      await fail(ctx, row, 'expiryNotices', err, false);
    }
  }
  return { ok: true, sent, candidates: rows.length };
};

// ---------------------------------------------------------------------------------------------
// autoRenew -> billing
// ---------------------------------------------------------------------------------------------

/**
 * TODO(billing): replace with the billing module's exported function once it exists, e.g.
 * `createRenewalInvoiceItem(db, { clientId, domainId, description, amount, currency, periodStart, periodEnd })`
 * from `@provisia/core` or `apps/api/src/modules/billing`. Until then this stub logs the intent,
 * records it in `domain_sync_log` and marks the domain so the item is not created twice.
 */
async function createRenewalInvoiceItem(
  ctx: JobContext,
  row: DomainRow,
  input: {
    amount: number;
    currency: string;
    periodStart: string;
    periodEnd: string;
    description: string;
  },
): Promise<{ created: boolean; via: string }> {
  ctx.logger.warn(
    { domainId: row.id, ...input },
    'auto-renew: billing integration not available, invoice item NOT created (stub)',
  );
  return { created: false, via: 'stub' };
}

function addYears(isoDate: string, years: number): string {
  const d = new Date(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export const autoRenew: JobHandler<JobData<'domains', 'autoRenew'>> = async (ctx) => {
  const cutoff = new Date(Date.now() + DOMAIN_AUTO_RENEW_DAYS_BEFORE * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await ctx.db
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.status, 'active'),
        eq(domains.autoRenew, true),
        isNotNull(domains.expiryDate),
        lte(domains.expiryDate, cutoff),
      ),
    );
  let created = 0;
  let stubbed = 0;
  for (const row of rows) {
    if (row.autoRenewInvoicedAt || !row.expiryDate) continue;
    const [tld] = await ctx.db.select().from(tlds).where(eq(tlds.tld, row.tld));
    const [price] = tld
      ? await ctx.db
          .select()
          .from(tldPrices)
          .where(
            and(
              eq(tldPrices.tldId, tld.id),
              eq(tldPrices.years, 1),
              eq(tldPrices.currency, row.currency),
            ),
          )
      : [];
    const amount = price?.renew ?? row.recurringAmount;
    const input = {
      amount,
      currency: row.currency,
      periodStart: row.expiryDate,
      periodEnd: addYears(row.expiryDate, 1),
      description: `Domain renewal: ${row.name} (1 year)`,
    };
    try {
      const res = await createRenewalInvoiceItem(ctx, row, input);
      if (res.created) created++;
      else stubbed++;
      await ctx.db
        .update(domains)
        .set({ autoRenewInvoicedAt: new Date() })
        .where(eq(domains.id, row.id));
      await logSync(ctx.db, {
        domainId: row.id,
        job: 'autoRenew',
        status: res.created ? 'ok' : 'skipped',
        message: res.created
          ? 'renewal invoice item created'
          : 'billing stub: renewal item NOT created',
        details: { ...input, via: res.via },
      });
      if (!res.created) {
        await raiseAlert(ctx.db, {
          domainId: row.id,
          severity: 'warning',
          kind: 'auto_renew_unbilled',
          title: `Auto-renew pending billing: ${row.name}`,
          message: `${row.name} expires ${row.expiryDate}; renewal must be invoiced manually until billing integration lands.`,
          details: input,
        });
      }
    } catch (err) {
      await fail(ctx, row, 'autoRenew', err, false);
    }
  }
  return { ok: true, created, stubbed, candidates: rows.length };
};

// ---------------------------------------------------------------------------------------------
// importPricing
// ---------------------------------------------------------------------------------------------

export const importPricing: JobHandler<JobData<'domains', 'importPricing'>> = async (
  ctx,
  data,
  job,
) => {
  try {
    const { registrar, mctx } = await resolveRegistrar(ctx, data.registrarModule);
    if (!registrar.getTldPricing)
      throw new DomainJobError('registrar_unsupported', 'registrar publishes no pricing');
    const prices: TldPrice[] = await registrar.getTldPricing(mctx);
    const markup = 1 + data.markupPercent / 100;
    const sell = (cost: number) => roundHalfUp(cost * markup);
    let updated = 0;
    let created = 0;
    for (const p of prices) {
      let [tld] = await ctx.db.select().from(tlds).where(eq(tlds.tld, p.tld));
      if (!tld) {
        if (!data.createMissing) continue;
        [tld] = await ctx.db
          .insert(tlds)
          .values({
            tld: p.tld,
            registrarModule: registrar.id,
            enabled: false,
            currency: p.currency,
            minYears: p.minYears,
            maxYears: p.maxYears,
          })
          .returning();
        if (!tld) continue;
        created++;
      }
      const [existing] = await ctx.db
        .select()
        .from(tldPrices)
        .where(
          and(
            eq(tldPrices.tldId, tld.id),
            eq(tldPrices.years, 1),
            eq(tldPrices.currency, p.currency),
          ),
        );
      const cost = { costRegister: p.register, costRenew: p.renew, costTransfer: p.transfer };
      if (!existing) {
        await ctx.db.insert(tldPrices).values({
          tldId: tld.id,
          years: 1,
          currency: p.currency,
          register: sell(p.register),
          renew: sell(p.renew),
          transfer: sell(p.transfer),
          ...cost,
        });
      } else {
        await ctx.db
          .update(tldPrices)
          .set({
            ...cost,
            ...(data.overwriteSellPrices
              ? { register: sell(p.register), renew: sell(p.renew), transfer: sell(p.transfer) }
              : {}),
          })
          .where(eq(tldPrices.id, existing.id));
      }
      updated++;
    }
    await ctx.db
      .update(registrarAccounts)
      .set({ pricingImportedAt: new Date() })
      .where(eq(registrarAccounts.module, registrar.id));
    await logSync(ctx.db, {
      job: 'importPricing',
      status: 'ok',
      message: `${registrar.id}: ${updated} TLDs priced, ${created} created`,
      details: { ...data, received: prices.length },
    });
    return { ok: true, received: prices.length, updated, created };
  } catch (err) {
    return fail(ctx, null, 'importPricing', err, hasAttemptsLeft(job));
  }
};

export const domainJobs = {
  register,
  transfer,
  renew,
  sync,
  expiryNotices,
  autoRenew,
  fetchEppCode,
  importPricing,
};

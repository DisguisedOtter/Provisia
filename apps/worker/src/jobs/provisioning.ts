/**
 * Provisioning queue processors. Every job: load service + product + server, resolve the provisioner
 * module, call it, persist `services.{status,module_data,username,password_encrypted,server_id}`, write a
 * `provisioning_log` row. BullMQ retries 3x with exponential backoff (DEFAULT_JOB_OPTIONS); on the final
 * attempt the service is flagged (`module_data.lastError`, status back to `pending` for create) and the
 * staff is notified.
 */
import {
  clients,
  type Db,
  orderItems,
  orders,
  products,
  provisioningLog,
  serverGroups,
  servers,
  services,
  serviceUsage,
  users,
} from '@provisia/db';
import {
  createModuleContext,
  decrypt,
  decryptJson,
  encrypt,
  type ModuleContext,
  ModuleRegistry,
  type PowerAction,
  type Provisioner,
  type ServerDTO,
  type ServiceDTO,
} from '@provisia/module-sdk';
import cpanel from '@provisia/provisioner-cpanel';
import directadmin from '@provisia/provisioner-directadmin';
import plesk from '@provisia/provisioner-plesk';
import proxmox from '@provisia/provisioner-proxmox';
import { skrimeServer, skrimeWebspace } from '@provisia/provisioner-skrime';
import { generatePassword, pickServer, type RemoteOption } from '@provisia/shared';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { JobContext, JobHandler } from '../context.js';
import { enqueue, getQueue, type JobData } from '../queues.js';

/* ------------------------------------------------------------------ registry */

let registry: ModuleRegistry | undefined;
/** Same provisioner list as `apps/api/src/modules/registry.ts` (the worker cannot import the api). */
export function provisionerRegistry(): ModuleRegistry {
  if (!registry) {
    registry = new ModuleRegistry();
    for (const p of [cpanel, plesk, directadmin, proxmox, skrimeWebspace, skrimeServer])
      registry.register('provisioner', p);
  }
  return registry;
}

/* ------------------------------------------------------------------ loading */

type ServerRow = typeof servers.$inferSelect;
type ProductRow = typeof products.$inferSelect;

export interface LoadedService {
  dto: ServiceDTO;
  product: ProductRow;
  server: ServerRow | null;
  module: Provisioner;
}

export function toServerDto(row: ServerRow): ServerDTO {
  const {
    credentialsEncrypted: _c,
    statusCheckedAt: _a,
    statusOk: _o,
    statusMessage: _m,
    ...rest
  } = row;
  return rest;
}

export class ProvisioningJobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** Non-retryable errors (bad data) skip BullMQ retries by being marked terminal. */
    public readonly permanent = false,
  ) {
    super(message);
    this.name = 'ProvisioningJobError';
  }
}

export async function loadService(
  db: Db,
  serviceId: string,
  opts: { withPassword?: boolean } = {},
): Promise<LoadedService> {
  const [row] = await db
    .select({ service: services, product: products, client: clients, user: users })
    .from(services)
    .innerJoin(products, eq(products.id, services.productId))
    .innerJoin(clients, eq(clients.id, services.clientId))
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row)
    throw new ProvisioningJobError('service_not_found', `service ${serviceId} not found`, true);
  if (!row.product.module) {
    throw new ProvisioningJobError(
      'no_module',
      `product ${row.product.name} has no provisioning module`,
      true,
    );
  }
  const module = provisionerRegistry().find('provisioner', row.product.module);
  if (!module) {
    throw new ProvisioningJobError(
      'unknown_module',
      `provisioner "${row.product.module}" is not installed`,
      true,
    );
  }
  let server: ServerRow | null = null;
  if (row.service.serverId) {
    [server = null] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, row.service.serverId))
      .limit(1);
  }
  const name = `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.email;
  const dto: ServiceDTO = {
    ...row.service,
    moduleData: { ...row.service.moduleData },
    product: row.product,
    server: server ? toServerDto(server) : null,
    client: {
      id: row.client.id,
      email: row.user.email,
      name,
      companyName: row.client.companyName,
      country: row.client.country,
    },
  };
  if (opts.withPassword && row.service.passwordEncrypted) {
    try {
      dto.password = decrypt(row.service.passwordEncrypted);
    } catch {
      /* unreadable password (key rotated) — module will generate a new one if it needs it */
    }
  }
  return { dto, product: row.product, server, module };
}

export function buildModuleContext(
  ctx: Pick<JobContext, 'logger' | 'appUrl' | 'webUrl'>,
  module: Provisioner,
  server: ServerRow | null,
  rawConfig: Record<string, unknown>,
  opts: { parseConfig?: boolean } = {},
): ModuleContext {
  const config = opts.parseConfig === false ? rawConfig : module.configSchema.parse(rawConfig);
  let credentials: Record<string, unknown> = {};
  if (server) {
    try {
      credentials = decryptJson<Record<string, unknown>>(server.credentialsEncrypted);
    } catch (err) {
      throw new ProvisioningJobError(
        'credentials_unreadable',
        `cannot decrypt credentials of server ${server.name}: ${(err as Error).message}`,
        true,
      );
    }
  }
  return createModuleContext({
    config: config as Record<string, unknown>,
    credentials,
    logger: ctx.logger,
    appUrl: ctx.appUrl,
    webUrl: ctx.webUrl,
  });
}

/* ------------------------------------------------------------------ server selection */

export async function serverCandidates(db: Db, groupName: string, module: string) {
  const rows = await db
    .select({
      id: servers.id,
      name: servers.name,
      maxAccounts: servers.maxAccounts,
      usedAccounts: sql<number>`(
        select count(*)::int from ${services}
        where ${services.serverId} = ${servers.id}
          and ${services.status} in ('pending', 'active', 'suspended')
      )`,
    })
    .from(servers)
    .where(
      and(eq(servers.groupName, groupName), eq(servers.module, module), eq(servers.active, true)),
    );
  return rows;
}

export async function chooseServer(db: Db, product: ProductRow): Promise<ServerRow> {
  if (!product.serverGroup || !product.module) {
    throw new ProvisioningJobError(
      'no_server_group',
      `product ${product.name} has no server group`,
      true,
    );
  }
  const [group] = await db
    .select()
    .from(serverGroups)
    .where(eq(serverGroups.name, product.serverGroup))
    .limit(1);
  const candidates = await serverCandidates(db, product.serverGroup, product.module);
  const picked = pickServer(candidates, group?.fillType ?? 'least_loaded');
  if (!picked) {
    throw new ProvisioningJobError(
      'no_capacity',
      `no server with free capacity in group "${product.serverGroup}" for module ${product.module}`,
    );
  }
  const [server] = await db.select().from(servers).where(eq(servers.id, picked.id)).limit(1);
  if (!server) throw new ProvisioningJobError('server_not_found', 'picked server vanished', true);
  return server;
}

/* ------------------------------------------------------------------ logging + failure handling */

interface LogInput {
  serviceId?: string | null;
  serverId?: string | null;
  action: string;
  status: 'success' | 'failed';
  message?: string | null;
  details?: Record<string, unknown> | null;
  actorUserId?: string | null;
  attempt?: number;
  durationMs?: number;
}

export async function writeProvisioningLog(db: Db, input: LogInput) {
  await db.insert(provisioningLog).values({
    serviceId: input.serviceId ?? null,
    serverId: input.serverId ?? null,
    action: input.action,
    status: input.status,
    message: input.message ?? null,
    details: input.details ?? null,
    actorUserId: input.actorUserId ?? null,
    attempt: input.attempt ?? 1,
    durationMs: input.durationMs ?? null,
  });
}

export function isFinalAttempt(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
  permanent = false,
): boolean {
  if (permanent) return true;
  const attempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}

/** Staff notification through the support agent's `notify()` (in-app + email). Never throws. */
async function notifyStaff(
  ctx: JobContext,
  input: { title: string; body: string; serviceId?: string; serverId?: string },
) {
  try {
    const specifier = '@provisia/email';
    const mod = (await import(specifier)) as {
      notify?: (
        db: Db,
        input: Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    if (!mod.notify) throw new Error('notify() not exported');
    await mod.notify(
      ctx.db,
      {
        level: 'error',
        type: 'provisioning.failed',
        title: input.title,
        body: input.body,
        link: input.serviceId
          ? `/admin/services/${input.serviceId}`
          : `/admin/servers/${input.serverId ?? ''}`,
        entityType: input.serviceId ? 'service' : 'server',
        entityId: input.serviceId ?? input.serverId,
        email: true,
      },
      { emailSink: (j: unknown) => getQueue('email').add('send', j), webUrl: ctx.webUrl },
    );
  } catch (err) {
    ctx.logger.warn({ err }, 'could not deliver provisioning failure notification');
  }
}

interface ActionOpts {
  serviceId: string;
  action: string;
  actorUserId?: string | undefined;
  /** When the final attempt fails: reset status to pending (create) */
  resetToPending?: boolean;
}

/**
 * Runs `fn`, records the outcome in provisioning_log and, on the final failed attempt, flags the service
 * and notifies staff. Rethrows so BullMQ handles retries/backoff.
 */
async function runServiceAction<T>(
  ctx: JobContext,
  job: Job,
  opts: ActionOpts,
  fn: (
    loaded: LoadedService,
  ) => Promise<{ result?: T; details?: Record<string, unknown> | null; message?: string }>,
): Promise<T | undefined> {
  const started = Date.now();
  let loaded: LoadedService | undefined;
  try {
    loaded = await loadService(ctx.db, opts.serviceId, { withPassword: true });
    const out = await fn(loaded);
    await writeProvisioningLog(ctx.db, {
      serviceId: opts.serviceId,
      serverId: loaded.dto.serverId,
      action: opts.action,
      status: 'success',
      message: out.message ?? null,
      details: out.details ?? null,
      actorUserId: opts.actorUserId ?? null,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - started,
    });
    return out.result;
  } catch (err) {
    const e = err as Error & { code?: string; permanent?: boolean; details?: unknown };
    const final = isFinalAttempt(job, e instanceof ProvisioningJobError && e.permanent);
    ctx.logger.error(
      { err, serviceId: opts.serviceId, action: opts.action, final },
      'provisioning action failed',
    );
    await writeProvisioningLog(ctx.db, {
      serviceId: opts.serviceId,
      serverId: loaded?.dto.serverId ?? null,
      action: opts.action,
      status: 'failed',
      message: e.message,
      details: {
        code: e.code ?? 'error',
        final,
        ...(e.details !== undefined ? { details: safeJson(e.details) } : {}),
      },
      actorUserId: opts.actorUserId ?? null,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - started,
    }).catch(() => undefined);
    if (final && loaded) {
      const moduleData = {
        ...loaded.dto.moduleData,
        lastError: {
          action: opts.action,
          message: e.message,
          code: e.code ?? 'error',
          at: new Date().toISOString(),
        },
      };
      await ctx.db
        .update(services)
        .set(opts.resetToPending ? { status: 'pending', moduleData } : { moduleData })
        .where(eq(services.id, opts.serviceId));
      await notifyStaff(ctx, {
        title: `Provisioning ${opts.action} failed: ${loaded.product.name}`,
        body: `${e.message} (service ${opts.serviceId}, ${loaded.dto.domain ?? loaded.dto.username ?? 'no domain'})`,
        serviceId: opts.serviceId,
      });
    } else if (final) {
      await notifyStaff(ctx, {
        title: `Provisioning ${opts.action} failed`,
        body: `${e.message} (service ${opts.serviceId})`,
        serviceId: opts.serviceId,
      });
    }
    if (e instanceof ProvisioningJobError && e.permanent) {
      // Tell BullMQ not to retry: UnrecoverableError semantics without importing the class in tests.
      (e as Error & { name: string }).name = 'UnrecoverableError';
    }
    throw err;
  }
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------ processors */

export const create: JobHandler<JobData<'provisioning', 'create'>> = async (ctx, data, job) =>
  runServiceAction(
    ctx,
    job,
    {
      serviceId: data.serviceId,
      action: 'create',
      actorUserId: data.actorUserId,
      resetToPending: true,
    },
    async (loaded) => {
      if (loaded.dto.status === 'active' && Object.keys(loaded.dto.moduleData).length > 0) {
        return { message: 'already active, skipped' };
      }
      let server = loaded.server;
      if (data.serverId && (!server || server.id !== data.serverId)) {
        [server = null] = await ctx.db
          .select()
          .from(servers)
          .where(eq(servers.id, data.serverId))
          .limit(1);
        if (!server)
          throw new ProvisioningJobError(
            'server_not_found',
            `server ${data.serverId} not found`,
            true,
          );
      }
      if (!server) server = await chooseServer(ctx.db, loaded.product);
      if (server.module !== loaded.product.module) {
        throw new ProvisioningJobError(
          'module_mismatch',
          `server ${server.name} runs ${server.module}, product needs ${loaded.product.module}`,
          true,
        );
      }
      if (loaded.dto.serverId !== server.id) {
        await ctx.db
          .update(services)
          .set({ serverId: server.id })
          .where(eq(services.id, loaded.dto.id));
        loaded.dto.serverId = server.id;
      }
      loaded.dto.server = toServerDto(server);
      loaded.dto.password ??= generatePassword();
      const mctx = buildModuleContext(ctx, loaded.module, server, loaded.product.moduleConfig);
      const result = await loaded.module.create(mctx, loaded.dto);
      const password = result.password ?? loaded.dto.password;
      await ctx.db
        .update(services)
        .set({
          status: 'active',
          serverId: server.id,
          moduleData: { ...loaded.dto.moduleData, ...result.moduleData, lastError: undefined },
          username: result.username ?? loaded.dto.username,
          ...(password ? { passwordEncrypted: encrypt(password) } : {}),
        })
        .where(eq(services.id, loaded.dto.id));
      await ctx.db.update(servers).set({ updatedAt: new Date() }).where(eq(servers.id, server.id));
      return {
        message: result.message ?? 'created',
        details: { username: result.username, ipAddress: result.ipAddress, server: server.name },
        result: { serverId: server.id, username: result.username },
      };
    },
  );

function statusAction(
  action: 'suspend' | 'unsuspend' | 'terminate',
  nextStatus: 'suspended' | 'active' | 'terminated',
): JobHandler<{ serviceId: string; reason?: string; actorUserId?: string }> {
  return (ctx, data, job) =>
    runServiceAction(
      ctx,
      job,
      { serviceId: data.serviceId, action, actorUserId: data.actorUserId },
      async (loaded) => {
        if (loaded.dto.status === 'terminated' || loaded.dto.status === 'cancelled') {
          if (action === 'terminate') return { message: `already ${loaded.dto.status}` };
          throw new ProvisioningJobError(
            'bad_state',
            `cannot ${action} a ${loaded.dto.status} service`,
            true,
          );
        }
        if (loaded.dto.status === 'pending' && Object.keys(loaded.dto.moduleData).length === 0) {
          if (action === 'terminate') {
            await ctx.db
              .update(services)
              .set({ status: 'terminated' })
              .where(eq(services.id, loaded.dto.id));
            return { message: 'never provisioned; marked terminated' };
          }
          throw new ProvisioningJobError(
            'not_provisioned',
            'service has not been provisioned yet',
            true,
          );
        }
        const mctx = buildModuleContext(
          ctx,
          loaded.module,
          loaded.server,
          loaded.product.moduleConfig,
        );
        if (action === 'suspend') await loaded.module.suspend(mctx, loaded.dto, data.reason);
        else if (action === 'unsuspend') await loaded.module.unsuspend(mctx, loaded.dto);
        else await loaded.module.terminate(mctx, loaded.dto);
        await ctx.db
          .update(services)
          .set({
            status: nextStatus,
            moduleData: { ...loaded.dto.moduleData, lastError: undefined },
          })
          .where(eq(services.id, loaded.dto.id));
        return { message: `${action} ok`, details: data.reason ? { reason: data.reason } : null };
      },
    );
}

export const suspend = statusAction('suspend', 'suspended');
export const unsuspend = statusAction('unsuspend', 'active');
export const terminate = statusAction('terminate', 'terminated');

export const changePackage: JobHandler<JobData<'provisioning', 'changePackage'>> = async (
  ctx,
  data,
  job,
) =>
  runServiceAction(
    ctx,
    job,
    { serviceId: data.serviceId, action: 'changePackage', actorUserId: data.actorUserId },
    async (loaded) => {
      const [next] = await ctx.db
        .select()
        .from(products)
        .where(eq(products.id, data.productId))
        .limit(1);
      if (!next)
        throw new ProvisioningJobError(
          'product_not_found',
          `product ${data.productId} not found`,
          true,
        );
      if (next.module !== loaded.product.module) {
        throw new ProvisioningJobError(
          'module_mismatch',
          'target product uses a different provisioning module',
          true,
        );
      }
      if (!loaded.module.changePackage) {
        throw new ProvisioningJobError(
          'unsupported',
          `${loaded.module.name} cannot change packages`,
          true,
        );
      }
      const mctx = buildModuleContext(
        ctx,
        loaded.module,
        loaded.server,
        loaded.product.moduleConfig,
      );
      await loaded.module.changePackage(mctx, loaded.dto, next);
      // Product id itself is switched by the billing agent (proration); we only sync the panel side.
      await ctx.db
        .update(services)
        .set({ moduleData: { ...loaded.dto.moduleData, lastError: undefined } })
        .where(eq(services.id, loaded.dto.id));
      return { message: `package changed to ${next.name}`, details: { productId: next.id } };
    },
  );

export const changePassword: JobHandler<JobData<'provisioning', 'changePassword'>> = async (
  ctx,
  data,
  job,
) =>
  runServiceAction(
    ctx,
    job,
    { serviceId: data.serviceId, action: 'changePassword', actorUserId: data.actorUserId },
    async (loaded) => {
      if (!loaded.module.changePassword) {
        throw new ProvisioningJobError(
          'unsupported',
          `${loaded.module.name} cannot change passwords`,
          true,
        );
      }
      const password = data.passwordEncrypted
        ? decrypt(data.passwordEncrypted)
        : generatePassword();
      const mctx = buildModuleContext(
        ctx,
        loaded.module,
        loaded.server,
        loaded.product.moduleConfig,
      );
      await loaded.module.changePassword(mctx, loaded.dto, password);
      await ctx.db
        .update(services)
        .set({ passwordEncrypted: encrypt(password) })
        .where(eq(services.id, loaded.dto.id));
      return { message: 'password changed' };
    },
  );

export const power: JobHandler<JobData<'provisioning', 'power'>> = async (ctx, data, job) =>
  runServiceAction(
    ctx,
    job,
    { serviceId: data.serviceId, action: `power:${data.action}`, actorUserId: data.actorUserId },
    async (loaded) => {
      if (!loaded.module.power) {
        throw new ProvisioningJobError(
          'unsupported',
          `${loaded.module.name} has no power control`,
          true,
        );
      }
      if (loaded.dto.status !== 'active') {
        throw new ProvisioningJobError('bad_state', `service is ${loaded.dto.status}`, true);
      }
      const mctx = buildModuleContext(
        ctx,
        loaded.module,
        loaded.server,
        loaded.product.moduleConfig,
      );
      await loaded.module.power(mctx, loaded.dto, data.action as PowerAction);
      return { message: `${data.action} ok` };
    },
  );

export const syncUsage: JobHandler<JobData<'provisioning', 'syncUsage'>> = async (
  ctx,
  data,
  job,
) => {
  if (!data.serviceId) {
    // Fan out: one job per provisioned service so one broken panel does not block the rest.
    const rows = await ctx.db
      .select({ id: services.id })
      .from(services)
      .innerJoin(products, eq(products.id, services.productId))
      .where(
        and(
          inArray(services.status, ['active', 'suspended']),
          isNotNull(products.module),
          isNotNull(services.serverId),
        ),
      );
    for (const r of rows) {
      await enqueue(
        'provisioning',
        'syncUsage',
        { serviceId: r.id },
        { jobId: `provisioning:syncUsage:${r.id}:${Date.now()}`, attempts: 1 },
      );
    }
    return { enqueued: rows.length };
  }
  const serviceId = data.serviceId;
  return runServiceAction(ctx, job, { serviceId, action: 'syncUsage' }, async (loaded) => {
    if (!loaded.module.getUsage) return { message: 'module has no usage support' };
    const mctx = buildModuleContext(ctx, loaded.module, loaded.server, loaded.product.moduleConfig);
    const u = await loaded.module.getUsage(mctx, loaded.dto);
    const row = {
      diskUsedMb: u.diskUsedMb ?? null,
      diskLimitMb: u.diskLimitMb ?? null,
      bandwidthUsedMb: u.bandwidthUsedMb ?? null,
      bandwidthLimitMb: u.bandwidthLimitMb ?? null,
      extra: u.extra ?? {},
      syncedAt: new Date(),
    };
    await ctx.db
      .insert(serviceUsage)
      .values({ serviceId, ...row })
      .onConflictDoUpdate({ target: serviceUsage.serviceId, set: row });
    return { message: 'usage synced', result: u };
  });
};

/** `loginUrl` is requested by the API and awaited (short-lived SSO link; never persisted). */
export const loginUrl: JobHandler<JobData<'provisioning', 'loginUrl'>> = async (ctx, data, job) =>
  runServiceAction(
    ctx,
    job,
    { serviceId: data.serviceId, action: 'loginUrl', actorUserId: data.actorUserId },
    async (loaded) => {
      if (!loaded.module.loginUrl) {
        throw new ProvisioningJobError(
          'unsupported',
          `${loaded.module.name} has no panel SSO`,
          true,
        );
      }
      if (loaded.dto.status !== 'active') {
        throw new ProvisioningJobError('bad_state', `service is ${loaded.dto.status}`, true);
      }
      const mctx = buildModuleContext(
        ctx,
        loaded.module,
        loaded.server,
        loaded.product.moduleConfig,
      );
      const url = await loaded.module.loginUrl(mctx, loaded.dto);
      return { message: 'login url issued', result: { url } };
    },
  );

/** Emitted by the billing agent when an order's invoice is paid: provision every pending service of it. */
export const activateOrder: JobHandler<JobData<'provisioning', 'activate-order'>> = async (
  ctx,
  data,
) => {
  const [order] = await ctx.db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);
  if (!order)
    throw new ProvisioningJobError('order_not_found', `order ${data.orderId} not found`, true);
  const items = await ctx.db
    .select({ serviceId: orderItems.serviceId, status: services.status, module: products.module })
    .from(orderItems)
    .innerJoin(services, eq(services.id, orderItems.serviceId))
    .innerJoin(products, eq(products.id, services.productId))
    .where(eq(orderItems.orderId, data.orderId));
  const enqueued: string[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    if (!it.serviceId) continue;
    if (it.status !== 'pending' || !it.module) {
      skipped.push(it.serviceId);
      continue;
    }
    await enqueue(
      'provisioning',
      'create',
      { serviceId: it.serviceId },
      { jobId: `provisioning:create:${it.serviceId}` },
    );
    enqueued.push(it.serviceId);
  }
  ctx.logger.info({ orderId: data.orderId, enqueued, skipped }, 'order activation dispatched');
  return { enqueued, skipped };
};

/* ------------------------------------------------------------------ server-level jobs (awaited by the API) */

async function loadServer(db: Db, serverId: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server)
    throw new ProvisioningJobError('server_not_found', `server ${serverId} not found`, true);
  const module = provisionerRegistry().find('provisioner', server.module);
  if (!module)
    throw new ProvisioningJobError(
      'unknown_module',
      `provisioner "${server.module}" is not installed`,
      true,
    );
  return { server, module };
}

export const testConnection: JobHandler<JobData<'provisioning', 'testConnection'>> = async (
  ctx,
  data,
) => {
  const { server, module } = await loadServer(ctx.db, data.serverId);
  const started = Date.now();
  let result: { ok: boolean; message?: string };
  try {
    const mctx = buildModuleContext(ctx, module, server, {}, { parseConfig: false });
    result = await module.testConnection(mctx, toServerDto(server));
  } catch (err) {
    result = { ok: false, message: (err as Error).message };
  }
  await ctx.db
    .update(servers)
    .set({
      statusCheckedAt: new Date(),
      statusOk: result.ok,
      statusMessage: result.message ?? null,
    })
    .where(eq(servers.id, server.id));
  await writeProvisioningLog(ctx.db, {
    serverId: server.id,
    action: 'testConnection',
    status: result.ok ? 'success' : 'failed',
    message: result.message ?? null,
    actorUserId: data.actorUserId ?? null,
    durationMs: Date.now() - started,
  });
  return result;
};

export const discover: JobHandler<JobData<'provisioning', 'discover'>> = async (ctx, data) => {
  const { server, module } = await loadServer(ctx.db, data.serverId);
  if (!module.listRemoteOptions) return [] satisfies RemoteOption[];
  const mctx = buildModuleContext(ctx, module, server, data.config ?? {}, { parseConfig: false });
  return module.listRemoteOptions(mctx, toServerDto(server), data.kind);
};

/**
 * Module specific action (`Provisioner.extras`): validates the params with the action's schema, runs it in
 * the worker and returns the result to the waiting API request. A `newPassword` in the result is stored
 * as the service password (reinstall / reset flows). Read-only actions are not written to the log.
 */
export const extra: JobHandler<JobData<'provisioning', 'extra'>> = async (ctx, data, job) => {
  const loaded = await loadService(ctx.db, data.serviceId, { withPassword: true });
  const action = loaded.module.extras?.find((a) => a.id === data.action);
  if (!action) {
    throw new ProvisioningJobError(
      'unsupported',
      `${loaded.module.name} has no action ${data.action}`,
      true,
    );
  }
  if (action.audience === 'staff' && data.audience !== 'staff') {
    throw new ProvisioningJobError('forbidden', `${action.id} is a staff action`, true);
  }
  if (loaded.dto.status !== 'active') {
    throw new ProvisioningJobError('bad_state', `service is ${loaded.dto.status}`, true);
  }
  const parsed = action.paramsSchema ? action.paramsSchema.safeParse(data.params ?? {}) : null;
  if (parsed && !parsed.success) {
    throw new ProvisioningJobError(
      'validation_error',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      true,
    );
  }
  const params = (parsed?.data ?? data.params ?? {}) as Record<string, unknown>;
  const run = async (l: LoadedService) => {
    const mctx = buildModuleContext(ctx, l.module, l.server, l.product.moduleConfig);
    const result = (await action.run(mctx, l.dto, params)) as Record<string, unknown> | undefined;
    const update: Record<string, unknown> = {};
    if (result && typeof result.newPassword === 'string') {
      update.passwordEncrypted = encrypt(result.newPassword);
    }
    if (Object.keys(l.dto.moduleData).length > 0) update.moduleData = l.dto.moduleData;
    if (Object.keys(update).length > 0) {
      await ctx.db.update(services).set(update).where(eq(services.id, l.dto.id));
    }
    return { result, message: `${action.id} ok` };
  };
  if (action.readOnly) return (await run(loaded)).result;
  return runServiceAction(
    ctx,
    job,
    { serviceId: data.serviceId, action: `extra:${action.id}`, actorUserId: data.actorUserId },
    run,
  );
};

export const provisioningJobs = {
  create,
  extra,
  suspend,
  unsuspend,
  terminate,
  changePackage,
  changePassword,
  syncUsage,
  power,
  loginUrl,
  'activate-order': activateOrder,
  testConnection,
  discover,
};

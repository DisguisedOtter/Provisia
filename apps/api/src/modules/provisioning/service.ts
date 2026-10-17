import { type Db, products, provisioningLog, services, serviceUsage } from '@provisia/db';
import { encrypt, type ModuleRegistry } from '@provisia/module-sdk';
import {
  type Paginated,
  type PowerAction,
  type ProvisioningAction,
  type ProvisioningLog,
  pageOffset,
  paginate,
  type QueuedJob,
  type ServiceUsage,
} from '@provisia/shared';
import { enqueue, type JobData } from '@provisia/worker/queues';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import type { LogQuery, PortalProvisioningInfo } from './schemas.js';

type ServiceRow = typeof services.$inferSelect;
type ProductRow = typeof products.$inferSelect;

export async function loadServiceWithProduct(
  db: Db,
  serviceId: string,
): Promise<{ service: ServiceRow; product: ProductRow }> {
  const [row] = await db
    .select({ service: services, product: products })
    .from(services)
    .innerJoin(products, eq(products.id, services.productId))
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row) throw notFound('Service');
  return row;
}

/** Portal guard: the service must belong to the logged-in client. */
export async function loadOwnedService(
  db: Db,
  serviceId: string,
  clientId: string | null | undefined,
) {
  const row = await loadServiceWithProduct(db, serviceId);
  if (!clientId || row.service.clientId !== clientId)
    throw forbidden('This service does not belong to you');
  return row;
}

function requireModule(registry: ModuleRegistry, product: ProductRow) {
  if (!product.module) throw badRequest('This product has no provisioning module');
  const mod = registry.find('provisioner', product.module);
  if (!mod) throw badRequest(`Provisioning module "${product.module}" is not installed`);
  return mod;
}

type ActionPayload = {
  [A in ProvisioningAction]: JobData<'provisioning', A>;
};

/** Enqueues one provisioning job with a deterministic id so double clicks do not double-provision. */
export async function enqueueAction<A extends ProvisioningAction>(
  action: A,
  payload: ActionPayload[A],
  opts: { unique?: boolean } = {},
): Promise<QueuedJob> {
  const serviceId = (payload as { serviceId: string }).serviceId;
  const jobId =
    opts.unique === false
      ? undefined
      : `provisioning:${action}:${serviceId}:${Math.floor(Date.now() / 1000)}`;
  try {
    const job = await enqueue(
      'provisioning',
      action,
      payload as JobData<'provisioning', A>,
      jobId ? { jobId } : undefined,
    );
    return { jobId: String(job.id), queue: 'provisioning', name: action, serviceId };
  } catch (err) {
    throw new AppError(
      'queue_unavailable',
      `Cannot reach the job queue: ${(err as Error).message}`,
      503,
    );
  }
}

/* ------------------------------------------------------------------ admin actions */

export interface AdminActionInput {
  registry: ModuleRegistry;
  actorUserId: string;
}

export async function adminCreate(
  db: Db,
  inp: AdminActionInput,
  serviceId: string,
  serverId?: string,
): Promise<QueuedJob> {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  requireModule(inp.registry, product);
  if (service.status === 'terminated' || service.status === 'cancelled') {
    throw badRequest(`Cannot provision a ${service.status} service`);
  }
  if (service.status === 'active' && Object.keys(service.moduleData).length > 0) {
    throw badRequest('Service is already provisioned');
  }
  return enqueueAction('create', { serviceId, serverId, actorUserId: inp.actorUserId });
}

export async function adminSuspend(
  db: Db,
  inp: AdminActionInput,
  serviceId: string,
  reason?: string,
) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  requireModule(inp.registry, product);
  if (service.status !== 'active')
    throw badRequest(`Only active services can be suspended (status: ${service.status})`);
  return enqueueAction('suspend', { serviceId, reason, actorUserId: inp.actorUserId });
}

export async function adminUnsuspend(db: Db, inp: AdminActionInput, serviceId: string) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  requireModule(inp.registry, product);
  if (service.status !== 'suspended')
    throw badRequest(`Only suspended services can be unsuspended (status: ${service.status})`);
  return enqueueAction('unsuspend', { serviceId, actorUserId: inp.actorUserId });
}

export async function adminTerminate(db: Db, inp: AdminActionInput, serviceId: string) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  requireModule(inp.registry, product);
  if (service.status === 'terminated') throw badRequest('Service is already terminated');
  return enqueueAction('terminate', { serviceId, actorUserId: inp.actorUserId });
}

export async function adminChangePackage(
  db: Db,
  inp: AdminActionInput,
  serviceId: string,
  productId: string,
) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  const mod = requireModule(inp.registry, product);
  if (!mod.changePackage) throw badRequest(`${mod.name} does not support package changes`);
  if (service.status !== 'active') throw badRequest('Only active services can change package');
  const [target] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!target) throw notFound('Target product');
  if (target.module !== product.module)
    throw badRequest('Target product uses a different provisioning module');
  return enqueueAction('changePackage', { serviceId, productId, actorUserId: inp.actorUserId });
}

export async function adminChangePassword(
  db: Db,
  inp: AdminActionInput,
  serviceId: string,
  password?: string,
) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  const mod = requireModule(inp.registry, product);
  if (!mod.changePassword) throw badRequest(`${mod.name} does not support password changes`);
  if (service.status !== 'active') throw badRequest('Only active services can change password');
  return enqueueAction('changePassword', {
    serviceId,
    passwordEncrypted: password ? encrypt(password) : undefined,
    actorUserId: inp.actorUserId,
  });
}

export async function adminSyncUsage(db: Db, inp: AdminActionInput, serviceId: string) {
  const { product } = await loadServiceWithProduct(db, serviceId);
  const mod = requireModule(inp.registry, product);
  if (!mod.getUsage) throw badRequest(`${mod.name} does not report usage`);
  return enqueueAction('syncUsage', { serviceId });
}

export async function adminPower(
  db: Db,
  inp: AdminActionInput,
  serviceId: string,
  action: PowerAction,
) {
  const { service, product } = await loadServiceWithProduct(db, serviceId);
  const mod = requireModule(inp.registry, product);
  if (!mod.power) throw badRequest(`${mod.name} has no power control`);
  if (service.status !== 'active') throw badRequest('Service is not active');
  return enqueueAction('power', { serviceId, action, actorUserId: inp.actorUserId });
}

/* ------------------------------------------------------------------ reads */

export async function getUsage(db: Db, serviceId: string): Promise<ServiceUsage | null> {
  const [row] = await db
    .select()
    .from(serviceUsage)
    .where(eq(serviceUsage.serviceId, serviceId))
    .limit(1);
  return row ?? null;
}

export async function listLog(
  db: Db,
  serviceId: string,
  q: LogQuery,
): Promise<Paginated<ProvisioningLog>> {
  const where: SQL | undefined = and(
    eq(provisioningLog.serviceId, serviceId),
    q.action ? eq(provisioningLog.action, q.action) : undefined,
    q.status ? eq(provisioningLog.status, q.status) : undefined,
  );
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select()
      .from(provisioningLog)
      .where(where)
      .orderBy(desc(provisioningLog.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ total: count() }).from(provisioningLog).where(where),
  ]);
  return paginate(rows, total, q);
}

export async function portalInfo(
  db: Db,
  registry: ModuleRegistry,
  service: ServiceRow,
  product: ProductRow,
): Promise<PortalProvisioningInfo> {
  const mod = product.module ? registry.find('provisioner', product.module) : undefined;
  const usage = await getUsage(db, service.id);
  const md = service.moduleData as { ip?: string; ipAddress?: string };
  return {
    serviceId: service.id,
    module: product.module,
    capabilities: {
      loginUrl: Boolean(mod?.loginUrl),
      resetPassword: Boolean(mod?.changePassword),
      power: Boolean(mod?.power),
      usage: Boolean(mod?.getUsage),
    },
    username: service.username,
    ipAddress: md.ip ?? md.ipAddress ?? null,
    powerState: typeof usage?.extra.status === 'string' ? usage.extra.status : null,
  };
}

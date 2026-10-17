import { convertCycleAmount, prorate, prorationLines, toIsoDate } from '@provisia/core';
import {
  adjustCredit,
  BillingError,
  createDraftInvoice,
  type DraftItemInput,
  issueInvoice,
} from '@provisia/core/db';
import { clients, type Db, productPrices, products, services } from '@provisia/db';
import type {
  ChangeServicePackage,
  ChangeServicePackageResult,
  CreateService,
  Paginated,
  ServiceListQuery,
  ServiceWithProduct,
  UpdateService,
} from '@provisia/shared';
import { pageOffset, paginate } from '@provisia/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { AppError, notFound } from '../../lib/errors.js';

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
type ServiceRow = typeof services.$inferSelect;

function mapBillingError(err: unknown): never {
  if (err instanceof BillingError)
    throw new AppError(err.code, err.message, err.status, err.details);
  throw err;
}

function withProduct(row: ServiceRow, productName?: string | null): ServiceWithProduct {
  const { passwordEncrypted: _omit, ...rest } = row;
  return { ...rest, productName: productName ?? undefined };
}

/** Portal view: no module state, no staff notes. */
export function forClient(s: ServiceWithProduct): ServiceWithProduct {
  return { ...s, moduleData: {}, notes: null };
}

export async function getService(
  db: Executor,
  id: string,
  clientId?: string,
): Promise<ServiceWithProduct> {
  const [row] = await db
    .select({ service: services, productName: products.name })
    .from(services)
    .innerJoin(products, eq(products.id, services.productId))
    .where(eq(services.id, id));
  if (!row || (clientId && row.service.clientId !== clientId)) throw notFound('Service');
  return withProduct(row.service, row.productName);
}

export async function listServices(
  db: Db,
  q: ServiceListQuery,
  clientId?: string,
): Promise<Paginated<ServiceWithProduct>> {
  const where = and(
    q.status ? eq(services.status, q.status) : undefined,
    q.productId ? eq(services.productId, q.productId) : undefined,
    clientId
      ? eq(services.clientId, clientId)
      : q.clientId
        ? eq(services.clientId, q.clientId)
        : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ service: services, productName: products.name })
      .from(services)
      .innerJoin(products, eq(products.id, services.productId))
      .where(where)
      .orderBy(desc(services.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(services).where(where),
  ]);
  return paginate(
    rows.map((r) => withProduct(r.service, r.productName)),
    total?.n ?? 0,
    q,
  );
}

export async function createService(db: Db, input: CreateService): Promise<ServiceWithProduct> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw notFound('Product');
  const today = toIsoDate(new Date());
  const [row] = await db
    .insert(services)
    .values({
      ...input,
      registrationDate: input.registrationDate ?? today,
      nextDueDate:
        input.nextDueDate === undefined
          ? input.billingCycle === 'onetime'
            ? null
            : today
          : input.nextDueDate,
    })
    .returning({ id: services.id });
  if (!row) throw new Error('insert service failed');
  return getService(db, row.id);
}

export async function updateService(
  db: Db,
  id: string,
  patch: UpdateService,
): Promise<ServiceWithProduct> {
  const current = await getService(db, id);
  const now = new Date();
  const timestamps: Partial<typeof services.$inferInsert> = {};
  if (patch.status && patch.status !== current.status) {
    if (patch.status === 'suspended') timestamps.suspendedAt = now;
    if (patch.status === 'active') {
      timestamps.suspendedAt = null;
      timestamps.suspendReason = null;
    }
    if (patch.status === 'terminated' || patch.status === 'cancelled')
      timestamps.terminatedAt = now;
  }
  await db
    .update(services)
    .set({ ...patch, ...timestamps })
    .where(eq(services.id, id));
  return getService(db, id);
}

export async function deleteService(db: Db, id: string): Promise<void> {
  const current = await getService(db, id);
  if (!['terminated', 'cancelled'].includes(current.status)) {
    throw new AppError(
      'service_active',
      'Only terminated or cancelled services can be deleted',
      409,
    );
  }
  await db.delete(services).where(eq(services.id, id));
}

export async function cancelService(
  db: Db,
  id: string,
  input: { immediate: boolean; reason?: string },
  clientId?: string,
): Promise<ServiceWithProduct> {
  const current = await getService(db, id, clientId);
  if (['terminated', 'cancelled'].includes(current.status)) {
    throw new AppError('service_not_active', `Service is ${current.status}`, 409);
  }
  const now = new Date();
  const note = input.reason
    ? `${current.notes ? `${current.notes}\n` : ''}Cancellation: ${input.reason}`
    : current.notes;
  await db
    .update(services)
    .set(
      input.immediate
        ? {
            status: 'cancelled',
            terminatedAt: now,
            cancellationRequestedAt: current.cancellationRequestedAt ?? now,
            notes: note,
          }
        : { cancellationRequestedAt: now, notes: note },
    )
    .where(eq(services.id, id));
  return getService(db, id);
}

export async function changePackage(
  db: Db,
  id: string,
  input: ChangeServicePackage,
): Promise<ChangeServicePackageResult> {
  const now = new Date();
  const today = toIsoDate(now);
  try {
    return await db.transaction(async (tx) => {
      const [svc] = await tx.select().from(services).where(eq(services.id, id)).for('update');
      if (!svc) throw notFound('Service');
      if (svc.status !== 'active')
        throw new AppError('service_not_active', `Service is ${svc.status}`, 409);
      if (svc.billingCycle === 'onetime' || !svc.nextDueDate) {
        throw new AppError('onetime_not_prorated', 'One-time services cannot be prorated', 400);
      }
      const newCycle = input.billingCycle ?? svc.billingCycle;
      if (newCycle === 'onetime')
        throw new AppError('onetime_not_prorated', 'Cannot change to a one-time cycle', 400);
      const [oldProduct] = await tx.select().from(products).where(eq(products.id, svc.productId));
      const [newProduct] = await tx.select().from(products).where(eq(products.id, input.productId));
      if (!newProduct || !oldProduct) throw notFound('Product');
      const [newPrice] = await tx
        .select()
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, newProduct.id),
            eq(productPrices.billingCycle, newCycle),
            eq(productPrices.currency, svc.currency),
          ),
        );
      if (!newPrice)
        throw new AppError(
          'price_not_available',
          `${newProduct.name} has no ${newCycle} price in ${svc.currency}`,
          400,
        );

      const proration = prorate({
        changeDate: today,
        nextDueDate: svc.nextDueDate,
        billingCycle: svc.billingCycle,
        oldAmount: svc.recurringAmount,
        newAmount: convertCycleAmount(newPrice.recurring, newCycle, svc.billingCycle),
        anchorDay: Number(svc.registrationDate.slice(8, 10)),
        currency: svc.currency,
      });

      await tx
        .update(services)
        .set({
          productId: newProduct.id,
          billingCycle: newCycle,
          recurringAmount: newPrice.recurring,
        })
        .where(eq(services.id, id));

      let invoiceId: string | null = null;
      if (input.invoice !== false && proration.net !== 0) {
        const [client] = await tx
          .select({ language: clients.language })
          .from(clients)
          .where(eq(clients.id, svc.clientId));
        const lines = prorationLines(
          proration,
          { oldPlan: oldProduct.name, newPlan: newProduct.name },
          client?.language ?? 'en',
          today,
        );
        if (proration.net > 0) {
          const items: DraftItemInput[] = [];
          if (lines.creditLine)
            items.push({
              description: lines.creditLine.description,
              unitAmount: lines.creditLine.unitAmount,
              taxable: oldProduct.taxable,
              periodStart: lines.creditLine.periodStart,
              periodEnd: lines.creditLine.periodEnd,
            });
          if (lines.chargeLine)
            items.push({
              description: lines.chargeLine.description,
              unitAmount: lines.chargeLine.unitAmount,
              taxable: newProduct.taxable,
              serviceId: svc.id,
              periodStart: today,
              periodEnd: proration.periodEnd,
            });
          const draft = await createDraftInvoice(tx, {
            clientId: svc.clientId,
            items,
            now,
            notes: `Package change ${oldProduct.name} → ${newProduct.name}`,
          });
          const issued = await issueInvoice(tx, draft.id, { now });
          invoiceId = issued.invoice.id;
        } else {
          await adjustCredit(tx, svc.clientId, {
            amount: -proration.net,
            description: `Downgrade ${oldProduct.name} → ${newProduct.name}: unused period credited (${proration.daysRemaining}/${proration.daysInPeriod} days)`,
            now,
          });
        }
      }
      return { service: await getService(tx, id), proration, invoiceId };
    });
  } catch (err) {
    return mapBillingError(err);
  }
}

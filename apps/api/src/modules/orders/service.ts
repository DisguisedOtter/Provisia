import {
  calculateInvoice,
  domainPeriodStartingAt,
  isRecurring,
  lineTaxRate,
  periodStartingAt,
  resolveTax,
  toIsoDate,
} from '@provisia/core';
import {
  BillingError,
  cancelInvoice,
  createDraftInvoice,
  type DraftItemInput,
  getClient,
  issueInvoice,
  loadSettings,
  loadTaxRules,
  resolveClientTax,
  takeNextNumber,
} from '@provisia/core/db';
import {
  type Db,
  domains,
  invoices,
  orderItems,
  orders,
  productPrices,
  products,
  services,
  tldPrices,
  tlds,
} from '@provisia/db';
import type {
  CartItem,
  CartQuote,
  OrderAcceptResult,
  OrderListQuery,
  OrderWithItems,
  Paginated,
} from '@provisia/shared';
import { pageOffset, paginate } from '@provisia/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { AppError, notFound } from '../../lib/errors.js';

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function mapBillingError(err: unknown): never {
  if (err instanceof BillingError)
    throw new AppError(err.code, err.message, err.status, err.details);
  throw err;
}

interface PricedLine {
  item: CartItem;
  description: string;
  productId: string | null;
  productName: string | null;
  domainName: string | null;
  tld: typeof tlds.$inferSelect | null;
  billingCycle: CartItem['billingCycle'];
  quantity: number;
  /** Per unit / per period. */
  unitRecurring: number;
  unitSetup: number;
  /** Yearly renewal for domains (recurring amount of the domain row). */
  renewAmount: number;
  taxable: boolean;
}

function tldOf(name: string): string {
  const i = name.indexOf('.');
  return i < 0 ? name : name.slice(i + 1);
}

async function priceCart(db: Executor, currency: string, items: CartItem[]): Promise<PricedLine[]> {
  const out: PricedLine[] = [];
  for (const item of items) {
    if (item.type === 'product') {
      if (!item.productId)
        throw new AppError('bad_request', 'productId is required for product items', 400);
      const [product] = await db.select().from(products).where(eq(products.id, item.productId));
      if (!product || product.hidden) throw notFound('Product');
      const [price] = await db
        .select()
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, product.id),
            eq(productPrices.billingCycle, item.billingCycle),
            eq(productPrices.currency, currency),
          ),
        );
      if (!price) {
        throw new AppError(
          'price_not_available',
          `${product.name} is not available ${item.billingCycle} in ${currency}`,
          400,
        );
      }
      if (product.requiresDomain && !item.domainName) {
        throw new AppError('domain_required', `${product.name} requires a domain name`, 400);
      }
      out.push({
        item,
        description: item.domainName ? `${product.name} - ${item.domainName}` : product.name,
        productId: product.id,
        productName: product.name,
        domainName: item.domainName ?? null,
        tld: null,
        billingCycle: item.billingCycle,
        quantity: item.quantity,
        unitRecurring: price.recurring,
        unitSetup: price.setupFee,
        renewAmount: 0,
        taxable: product.taxable,
      });
      continue;
    }
    if (!item.domainName)
      throw new AppError('bad_request', 'domainName is required for domain items', 400);
    const tld = tldOf(item.domainName);
    const [tldRow] = await db
      .select()
      .from(tlds)
      .where(and(eq(tlds.tld, tld), eq(tlds.enabled, true)));
    const years = item.quantity;
    const [price] = tldRow
      ? await db
          .select()
          .from(tldPrices)
          .where(
            and(
              eq(tldPrices.tldId, tldRow.id),
              eq(tldPrices.years, years),
              eq(tldPrices.currency, currency),
            ),
          )
      : [];
    if (!tldRow || !price || years < tldRow.minYears || years > tldRow.maxYears) {
      throw new AppError(
        'tld_not_offered',
        `.${tld} is not offered for ${years} year(s) in ${currency}`,
        400,
      );
    }
    const [yearly] =
      years === 1
        ? [price]
        : await db
            .select()
            .from(tldPrices)
            .where(
              and(
                eq(tldPrices.tldId, tldRow.id),
                eq(tldPrices.years, 1),
                eq(tldPrices.currency, currency),
              ),
            );
    const isTransfer = item.type === 'domain_transfer';
    out.push({
      item,
      description: `${isTransfer ? 'Domain transfer' : 'Domain registration'} ${item.domainName} (${years} year${years > 1 ? 's' : ''})`,
      productId: null,
      productName: null,
      domainName: item.domainName,
      tld: tldRow,
      billingCycle: 'annually',
      quantity: 1,
      unitRecurring: isTransfer ? price.transfer : price.register,
      unitSetup: 0,
      renewAmount: yearly?.renew ?? price.register,
      taxable: true,
    });
  }
  return out;
}

function quoteFromLines(
  lines: PricedLine[],
  currency: string,
  rateFor: (taxable: boolean) => string,
  reverseCharge: boolean,
): CartQuote {
  const calc = calculateInvoice(
    lines.map((l) => ({
      quantity: 1,
      unitAmount: l.quantity * (l.unitRecurring + l.unitSetup),
      taxRate: rateFor(l.taxable),
    })),
    currency,
  );
  return {
    currency,
    lines: lines.map((l, i) => ({
      description: l.description,
      billingCycle: l.billingCycle,
      quantity: l.quantity,
      setupFee: l.quantity * l.unitSetup,
      amount: l.quantity * (l.unitRecurring + l.unitSetup),
      taxRate: calc.lines[i]?.taxRate ?? '0.00',
    })),
    subtotal: calc.subtotal,
    taxTotal: calc.taxTotal,
    total: calc.total,
    reverseCharge,
  };
}

async function taxFor(db: Executor, clientId: string) {
  const client = await getClient(db, clientId).catch(mapBillingError);
  const settings = await loadSettings(db);
  const decision = await resolveClientTax(db, client, settings, toIsoDate(new Date()));
  return { client, decision, rateFor: (taxable: boolean) => lineTaxRate(decision, taxable) };
}

/**
 * Quote for a visitor without an account. VAT follows the given country; a VAT number is only honoured
 * (reverse charge) once it has been VIES-validated at registration, so guests always see the gross price.
 */
export async function quoteGuestCart(
  db: Db,
  guest: { country: string; vatNumber?: string | null },
  items: CartItem[],
): Promise<CartQuote> {
  const settings = await loadSettings(db);
  const currency = settings['billing.currency'];
  const decision = resolveTax({
    clientCountry: guest.country,
    homeCountry: settings['company.country'],
    vatNumber: guest.vatNumber ?? null,
    vatValidated: false,
    taxExempt: false,
    rules: await loadTaxRules(db),
    asOf: toIsoDate(new Date()),
  });
  const lines = await priceCart(db, currency, items);
  return quoteFromLines(
    lines,
    currency,
    (taxable) => lineTaxRate(decision, taxable),
    decision.reverseCharge,
  );
}

export async function quoteCart(db: Db, clientId: string, items: CartItem[]): Promise<CartQuote> {
  const { client, decision, rateFor } = await taxFor(db, clientId);
  const lines = await priceCart(db, client.currency, items);
  return quoteFromLines(lines, client.currency, rateFor, decision.reverseCharge);
}

export async function getOrder(
  db: Executor,
  id: string,
  clientId?: string,
): Promise<OrderWithItems> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order || (clientId && order.clientId !== clientId)) throw notFound('Order');
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .orderBy(orderItems.createdAt);
  return { ...order, items };
}

export async function listOrders(
  db: Db,
  q: OrderListQuery,
  clientId?: string,
): Promise<Paginated<OrderWithItems>> {
  const where = and(
    q.status ? eq(orders.status, q.status) : undefined,
    clientId
      ? eq(orders.clientId, clientId)
      : q.clientId
        ? eq(orders.clientId, q.clientId)
        : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(q.perPage)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(orders).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];
  return paginate(
    rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) })),
    total?.n ?? 0,
    q,
  );
}

export async function createOrder(
  db: Db,
  input: {
    clientId: string;
    items: CartItem[];
    promoCode?: string;
    notes?: string;
    ip?: string | null;
  },
): Promise<OrderWithItems> {
  const { client, decision, rateFor } = await taxFor(db, input.clientId);
  const lines = await priceCart(db, client.currency, input.items);
  const quote = quoteFromLines(lines, client.currency, rateFor, decision.reverseCharge);
  return db.transaction(async (tx) => {
    const number = await takeNextNumber(tx, 'order', toIsoDate(new Date()));
    const [order] = await tx
      .insert(orders)
      .values({
        clientId: client.id,
        number,
        status: 'pending',
        currency: client.currency,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        promoCode: input.promoCode ?? null,
        ip: input.ip ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!order) throw new Error('insert order failed');
    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        type: l.item.type,
        productId: l.productId,
        domainName: l.domainName,
        billingCycle: l.billingCycle,
        quantity: l.item.quantity,
        setupFee: l.quantity * l.unitSetup,
        amount: l.quantity * l.unitRecurring,
        config: l.item.config,
      })),
    );
    return getOrder(tx, order.id);
  });
}

export interface AcceptOutcome {
  result: OrderAcceptResult;
  settled: boolean;
  domainJobs: Array<{ domainId: string; name: 'register' | 'transfer' }>;
}

export async function acceptOrder(
  db: Db,
  orderId: string,
  now = new Date(),
): Promise<AcceptOutcome> {
  const today = toIsoDate(now);
  try {
    return await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw notFound('Order');
      if (order.status !== 'pending')
        throw new AppError('order_not_pending', `Order is ${order.status}`, 409);
      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .orderBy(orderItems.createdAt);
      const client = await getClient(tx, order.clientId);
      const invoiceLines: DraftItemInput[] = [];
      const domainJobs: AcceptOutcome['domainJobs'] = [];

      for (const item of items) {
        if (item.type === 'product') {
          if (!item.productId) throw new AppError('bad_request', 'order item without product', 400);
          const [product] = await tx.select().from(products).where(eq(products.id, item.productId));
          if (!product) throw notFound('Product');
          const unitRecurring = Math.round(item.amount / Math.max(1, item.quantity));
          const recurring = isRecurring(item.billingCycle);
          const period = recurring ? periodStartingAt(today, item.billingCycle) : null;
          for (let n = 0; n < item.quantity; n++) {
            const [svc] = await tx
              .insert(services)
              .values({
                clientId: order.clientId,
                productId: product.id,
                status: 'pending',
                billingCycle: item.billingCycle,
                recurringAmount: unitRecurring,
                currency: order.currency,
                registrationDate: today,
                nextDueDate: recurring ? today : null,
                domain: item.domainName,
                moduleData: { config: item.config },
              })
              .returning({ id: services.id });
            if (!svc) throw new Error('insert service failed');
            if (n === 0)
              await tx
                .update(orderItems)
                .set({ serviceId: svc.id })
                .where(eq(orderItems.id, item.id));
            invoiceLines.push({
              description: item.domainName ? `${product.name} - ${item.domainName}` : product.name,
              unitAmount: unitRecurring,
              quantity: 1,
              taxable: product.taxable,
              serviceId: svc.id,
              periodStart: period ? period.start : null,
              periodEnd: period ? period.end : null,
            });
          }
          if (item.setupFee > 0) {
            invoiceLines.push({
              description: `Setup fee - ${product.name}`,
              unitAmount: item.setupFee,
              quantity: 1,
              taxable: product.taxable,
            });
          }
          continue;
        }
        if (!item.domainName) throw new AppError('bad_request', 'domain item without name', 400);
        const tld = tldOf(item.domainName);
        const [tldRow] = await tx.select().from(tlds).where(eq(tlds.tld, tld));
        const [yearly] = tldRow
          ? await tx
              .select()
              .from(tldPrices)
              .where(
                and(
                  eq(tldPrices.tldId, tldRow.id),
                  eq(tldPrices.years, 1),
                  eq(tldPrices.currency, order.currency),
                ),
              )
          : [];
        const years = Math.max(1, item.quantity);
        const isTransfer = item.type === 'domain_transfer';
        const [dom] = await tx
          .insert(domains)
          .values({
            clientId: order.clientId,
            name: item.domainName,
            tld,
            registrarModule: tldRow?.registrarModule ?? null,
            status: isTransfer ? 'pending_transfer' : 'pending',
            registrationPeriod: years,
            recurringAmount: yearly?.renew ?? item.amount,
            currency: order.currency,
          })
          .returning({ id: domains.id });
        if (!dom) throw new Error('insert domain failed');
        await tx.update(orderItems).set({ domainId: dom.id }).where(eq(orderItems.id, item.id));
        const period = domainPeriodStartingAt(today, years);
        invoiceLines.push({
          description: `${isTransfer ? 'Domain transfer' : 'Domain registration'} ${item.domainName} (${years} year${years > 1 ? 's' : ''})`,
          unitAmount: item.amount,
          quantity: 1,
          taxable: true,
          domainId: dom.id,
          periodStart: period.start,
          periodEnd: period.end,
        });
        domainJobs.push({ domainId: dom.id, name: isTransfer ? 'transfer' : 'register' });
      }

      let invoice: OrderAcceptResult['invoice'] = null;
      let settled = false;
      if (invoiceLines.length > 0) {
        const draft = await createDraftInvoice(tx, {
          clientId: client.id,
          items: invoiceLines,
          now,
          notes: `Order ${order.number}`,
        });
        const issued = await issueInvoice(tx, draft.id, { now });
        settled = issued.settled;
        invoice = {
          id: issued.invoice.id,
          number: issued.invoice.number,
          status: issued.invoice.status,
          total: issued.invoice.total,
        };
      }
      await tx
        .update(orders)
        .set({ status: 'active', invoiceId: invoice?.id ?? null })
        .where(eq(orders.id, orderId));
      const full = await getOrder(tx, orderId);
      return { result: { ...full, invoice }, settled, domainJobs };
    });
  } catch (err) {
    return mapBillingError(err);
  }
}

export async function closeOrder(
  db: Db,
  orderId: string,
  status: 'cancelled' | 'fraud',
  clientId?: string,
): Promise<OrderWithItems> {
  try {
    return await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || (clientId && order.clientId !== clientId)) throw notFound('Order');
      if (order.status !== 'pending')
        throw new AppError('order_not_pending', `Order is ${order.status}`, 409);
      if (order.invoiceId) {
        const [inv] = await tx
          .select({ status: invoices.status })
          .from(invoices)
          .where(eq(invoices.id, order.invoiceId));
        if (inv && ['draft', 'unpaid', 'collections'].includes(inv.status)) {
          await cancelInvoice(tx, order.invoiceId, { reason: `Order ${order.number} ${status}` });
        }
      }
      await tx.update(orders).set({ status }).where(eq(orders.id, orderId));
      return getOrder(tx, orderId);
    });
  } catch (err) {
    return mapBillingError(err);
  }
}

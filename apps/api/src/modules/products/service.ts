import { type Db, productGroups, productPrices, products, services } from '@provisia/db';
import {
  type CreateProduct,
  type CreateProductGroup,
  type Paginated,
  type ProductGroup,
  type ProductListQuery,
  type ProductWithPrices,
  pageOffset,
  paginate,
  type UpdateProduct,
  type UpdateProductGroup,
} from '@provisia/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError, notFound } from '../../lib/errors.js';

// ---------------------------------------------------------------- groups

export async function listGroups(
  db: Db,
  opts: { includeHidden: boolean },
): Promise<ProductGroup[]> {
  return db
    .select()
    .from(productGroups)
    .where(opts.includeHidden ? undefined : eq(productGroups.hidden, false))
    .orderBy(asc(productGroups.sortOrder), asc(productGroups.name));
}

export async function createGroup(db: Db, input: CreateProductGroup): Promise<ProductGroup> {
  const [dup] = await db
    .select({ id: productGroups.id })
    .from(productGroups)
    .where(eq(productGroups.slug, input.slug));
  if (dup) throw new AppError('slug_taken', 'A product group with this slug already exists', 409);
  const [row] = await db
    .insert(productGroups)
    .values({ ...input, description: input.description ?? null })
    .returning();
  if (!row) throw new Error('group insert failed');
  return row;
}

export async function updateGroup(
  db: Db,
  id: string,
  patch: UpdateProductGroup,
): Promise<ProductGroup> {
  if (patch.slug) {
    const [dup] = await db
      .select({ id: productGroups.id })
      .from(productGroups)
      .where(eq(productGroups.slug, patch.slug));
    if (dup && dup.id !== id)
      throw new AppError('slug_taken', 'A product group with this slug already exists', 409);
  }
  const [row] = await db
    .update(productGroups)
    .set(patch)
    .where(eq(productGroups.id, id))
    .returning();
  if (!row) throw notFound('Product group');
  return row;
}

export async function deleteGroup(db: Db, id: string): Promise<void> {
  const [exists] = await db
    .select({ id: productGroups.id })
    .from(productGroups)
    .where(eq(productGroups.id, id));
  if (!exists) throw notFound('Product group');
  const [used] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.groupId, id))
    .limit(1);
  if (used)
    throw new AppError('group_not_empty', 'Move or delete the products in this group first', 409);
  await db.delete(productGroups).where(eq(productGroups.id, id));
}

// ---------------------------------------------------------------- products

async function attachPrices(
  db: Db,
  rows: Array<typeof products.$inferSelect>,
): Promise<ProductWithPrices[]> {
  if (rows.length === 0) return [];
  const prices = await db
    .select()
    .from(productPrices)
    .where(
      inArray(
        productPrices.productId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(productPrices.currency), asc(productPrices.billingCycle));
  return rows.map((p) => ({ ...p, prices: prices.filter((x) => x.productId === p.id) }));
}

export async function listProducts(
  db: Db,
  q: ProductListQuery,
): Promise<Paginated<ProductWithPrices>> {
  const where = and(
    q.groupId ? eq(products.groupId, q.groupId) : undefined,
    q.type ? eq(products.type, q.type) : undefined,
    q.includeHidden ? undefined : eq(products.hidden, false),
  );
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.name))
    .limit(q.perPage)
    .offset(pageOffset(q));
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(where);
  return paginate(await attachPrices(db, rows), cnt?.n ?? 0, q);
}

/** Storefront: a visible product (in a visible group) by id or slug. */
export async function getPublicProduct(db: Db, idOrSlug: string): Promise<ProductWithPrices> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const [row] = await db
    .select({ product: products })
    .from(products)
    .innerJoin(productGroups, eq(productGroups.id, products.groupId))
    .where(
      and(
        isUuid ? eq(products.id, idOrSlug) : eq(products.slug, idOrSlug),
        eq(products.hidden, false),
        eq(productGroups.hidden, false),
      ),
    )
    .limit(1);
  if (!row) throw notFound('Product');
  const [withPrices] = await attachPrices(db, [row.product]);
  if (!withPrices) throw notFound('Product');
  return withPrices;
}

export async function getProduct(db: Db, id: string): Promise<ProductWithPrices> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!row) throw notFound('Product');
  const [withPrices] = await attachPrices(db, [row]);
  if (!withPrices) throw notFound('Product');
  return withPrices;
}

async function assertSlugFree(db: Db, slug: string, exceptId?: string) {
  const [dup] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug));
  if (dup && dup.id !== exceptId)
    throw new AppError('slug_taken', 'A product with this slug already exists', 409);
}

async function assertGroup(db: Db, groupId: string) {
  const [g] = await db
    .select({ id: productGroups.id })
    .from(productGroups)
    .where(eq(productGroups.id, groupId));
  if (!g) throw new AppError('group_not_found', 'Product group not found', 400);
}

export async function createProduct(db: Db, input: CreateProduct): Promise<ProductWithPrices> {
  await assertSlugFree(db, input.slug);
  await assertGroup(db, input.groupId);
  const { prices, ...fields } = input;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({ ...fields, description: fields.description ?? null })
      .returning({ id: products.id });
    if (!row) throw new Error('product insert failed');
    if (prices.length > 0)
      await tx.insert(productPrices).values(prices.map((p) => ({ ...p, productId: row.id })));
    return row.id;
  });
  return getProduct(db, id);
}

export async function updateProduct(
  db: Db,
  id: string,
  patch: UpdateProduct,
): Promise<ProductWithPrices> {
  await getProduct(db, id);
  if (patch.slug) await assertSlugFree(db, patch.slug, id);
  if (patch.groupId) await assertGroup(db, patch.groupId);
  const { prices, ...fields } = patch;
  await db.transaction(async (tx) => {
    if (Object.keys(fields).length > 0)
      await tx.update(products).set(fields).where(eq(products.id, id));
    if (prices) {
      for (const p of prices) {
        await tx
          .insert(productPrices)
          .values({ ...p, productId: id })
          .onConflictDoUpdate({
            target: [productPrices.productId, productPrices.billingCycle, productPrices.currency],
            set: { setupFee: p.setupFee, recurring: p.recurring },
          });
      }
      const keep = prices.map((p) => `${p.billingCycle}:${p.currency}`);
      const existing = await tx.select().from(productPrices).where(eq(productPrices.productId, id));
      const stale = existing
        .filter((e) => !keep.includes(`${e.billingCycle}:${e.currency}`))
        .map((e) => e.id);
      if (stale.length > 0) await tx.delete(productPrices).where(inArray(productPrices.id, stale));
    }
  });
  return getProduct(db, id);
}

export async function deleteProduct(db: Db, id: string): Promise<void> {
  await getProduct(db, id);
  const [used] = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.productId, id))
    .limit(1);
  if (used)
    throw new AppError('product_in_use', 'Services exist for this product; hide it instead', 409);
  await db.delete(products).where(eq(products.id, id));
}

/** Storefront catalog: visible groups with their visible products and prices. */
export async function publicCatalog(
  db: Db,
): Promise<Array<ProductGroup & { products: ProductWithPrices[] }>> {
  const groups = await listGroups(db, { includeHidden: false });
  if (groups.length === 0) return [];
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.hidden, false),
        inArray(
          products.groupId,
          groups.map((g) => g.id),
        ),
      ),
    )
    .orderBy(asc(products.sortOrder), asc(products.name));
  const withPrices = await attachPrices(db, rows);
  return groups.map((g) => ({ ...g, products: withPrices.filter((p) => p.groupId === g.id) }));
}

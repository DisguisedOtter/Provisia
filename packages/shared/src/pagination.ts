import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** `{ data: T[], meta: { page, perPage, total } }` — the only list envelope used by the API. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}
export type Paginated<T> = { data: T[]; meta: PaginationMeta };

/** Offset for SQL from a parsed pagination query. */
export function pageOffset(q: PaginationQuery): number {
  return (q.page - 1) * q.perPage;
}

/** Wraps rows + total count into the standard envelope. */
export function paginate<T>(data: T[], total: number, q: PaginationQuery): Paginated<T> {
  return { data, meta: { page: q.page, perPage: q.perPage, total } };
}

/** `{ data: T }` for single resources. */
export function dataSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: item });
}

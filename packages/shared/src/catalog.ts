import { z } from 'zod';
import {
  billingCycleSchema,
  currencyCodeSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const productTypeSchema = z.enum(['hosting', 'vps', 'domain', 'other']);
export type ProductType = z.infer<typeof productTypeSchema>;

export const productGroupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  hidden: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProductGroup = z.infer<typeof productGroupSchema>;

export const productPriceSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  billingCycle: billingCycleSchema,
  currency: currencyCodeSchema,
  setupFee: minorUnitsSchema,
  recurring: minorUnitsSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProductPrice = z.infer<typeof productPriceSchema>;

export const productSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  type: productTypeSchema,
  module: z.string().nullable(),
  moduleConfig: z.record(z.string(), z.unknown()),
  serverGroup: z.string().nullable(),
  taxable: z.boolean(),
  requiresDomain: z.boolean(),
  stockControl: z.boolean(),
  stock: z.number().int(),
  hidden: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Product = z.infer<typeof productSchema>;

/** Product with its prices, as listed in the admin and the order form. */
export const productWithPricesSchema = productSchema.extend({
  prices: z.array(productPriceSchema),
});
export type ProductWithPrices = z.infer<typeof productWithPricesSchema>;

export const upsertProductPriceSchema = productPriceSchema.pick({
  billingCycle: true,
  currency: true,
  setupFee: true,
  recurring: true,
});

export const createProductSchema = z.object({
  groupId: uuidSchema,
  name: z.string().min(1).max(150),
  slug: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().nullable().optional(),
  type: productTypeSchema.default('hosting'),
  module: z.string().max(50).nullable().optional(),
  moduleConfig: z.record(z.string(), z.unknown()).default({}),
  serverGroup: z.string().max(100).nullable().optional(),
  taxable: z.boolean().default(true),
  requiresDomain: z.boolean().default(false),
  stockControl: z.boolean().default(false),
  stock: z.number().int().min(0).default(0),
  hidden: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  prices: z.array(upsertProductPriceSchema).default([]),
});
export type CreateProduct = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProduct = z.infer<typeof updateProductSchema>;

export const createProductGroupSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  hidden: z.boolean().default(false),
});
export type CreateProductGroup = z.infer<typeof createProductGroupSchema>;

export const updateProductGroupSchema = createProductGroupSchema.partial();
export type UpdateProductGroup = z.infer<typeof updateProductGroupSchema>;

export const productListQuerySchema = paginationQuerySchema.extend({
  groupId: uuidSchema.optional(),
  type: productTypeSchema.optional(),
  includeHidden: z.coerce.boolean().default(false),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

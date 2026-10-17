import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import {
  createProductGroupSchema,
  createProductSchema,
  dataSchema,
  idParams,
  paginatedSchema,
  productGroupSchema,
  productListQuerySchema,
  productWithPricesSchema,
  updateProductGroupSchema,
  updateProductSchema,
} from './schemas.js';
import {
  createGroup,
  createProduct,
  deleteGroup,
  deleteProduct,
  getProduct,
  getPublicProduct,
  listGroups,
  listProducts,
  publicCatalog,
  updateGroup,
  updateProduct,
} from './service.js';

const TAG = ['products'];
const catalogResponse = dataSchema(
  z.array(productGroupSchema.extend({ products: z.array(productWithPricesSchema) })),
);
const groupsQuery = z.object({ includeHidden: z.coerce.boolean().default(true) });

const routes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- groups
  app.get(
    '/admin/product-groups',
    {
      preHandler: requirePermission('products.read'),
      schema: {
        tags: TAG,
        summary: 'List product groups',
        querystring: groupsQuery,
        response: { 200: dataSchema(z.array(productGroupSchema)) },
      },
    },
    async (req) => ({ data: await listGroups(app.db, req.query) }),
  );
  app.post(
    '/admin/product-groups',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Create a product group',
        body: createProductGroupSchema,
        response: { 201: dataSchema(productGroupSchema) },
      },
    },
    async (req, reply) => {
      const group = await createGroup(app.db, req.body);
      await activityLog(req, {
        action: 'product_group.create',
        entityType: 'product_group',
        entityId: group.id,
      });
      return reply.status(201).send({ data: group });
    },
  );
  app.patch(
    '/admin/product-groups/:id',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Update a product group',
        params: idParams,
        body: updateProductGroupSchema,
        response: { 200: dataSchema(productGroupSchema) },
      },
    },
    async (req) => {
      const group = await updateGroup(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'product_group.update',
        entityType: 'product_group',
        entityId: group.id,
        diff: { patch: req.body },
      });
      return { data: group };
    },
  );
  app.delete(
    '/admin/product-groups/:id',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Delete an empty product group',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await deleteGroup(app.db, req.params.id);
      await activityLog(req, {
        action: 'product_group.delete',
        entityType: 'product_group',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- products
  app.get(
    '/admin/products',
    {
      preHandler: requirePermission('products.read'),
      schema: {
        tags: TAG,
        summary: 'List products with prices',
        querystring: productListQuerySchema,
        response: { 200: paginatedSchema(productWithPricesSchema) },
      },
    },
    async (req) => listProducts(app.db, req.query),
  );
  app.post(
    '/admin/products',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Create a product with prices',
        body: createProductSchema,
        response: { 201: dataSchema(productWithPricesSchema) },
      },
    },
    async (req, reply) => {
      const product = await createProduct(app.db, req.body);
      await activityLog(req, {
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
      });
      return reply.status(201).send({ data: product });
    },
  );
  app.get(
    '/admin/products/:id',
    {
      preHandler: requirePermission('products.read'),
      schema: {
        tags: TAG,
        summary: 'Get a product',
        params: idParams,
        response: { 200: dataSchema(productWithPricesSchema) },
      },
    },
    async (req) => ({ data: await getProduct(app.db, req.params.id) }),
  );
  app.patch(
    '/admin/products/:id',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Update a product; `prices` replaces the price list',
        params: idParams,
        body: updateProductSchema,
        response: { 200: dataSchema(productWithPricesSchema) },
      },
    },
    async (req) => {
      const product = await updateProduct(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'product.update',
        entityType: 'product',
        entityId: product.id,
        diff: { patch: req.body },
      });
      return { data: product };
    },
  );
  app.delete(
    '/admin/products/:id',
    {
      preHandler: requirePermission('products.write'),
      schema: {
        tags: TAG,
        summary: 'Delete a product without services',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await deleteProduct(app.db, req.params.id);
      await activityLog(req, {
        action: 'product.delete',
        entityType: 'product',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- storefront
  app.get(
    '/public/products',
    {
      schema: {
        tags: ['public'],
        summary: 'Public catalog (visible groups/products with prices)',
        security: [],
        response: { 200: catalogResponse },
      },
    },
    async () => ({ data: await publicCatalog(app.db) }),
  );
  app.get(
    '/public/products/:idOrSlug',
    {
      schema: {
        tags: ['public'],
        summary: 'One visible product by id or slug (order form)',
        security: [],
        params: z.object({ idOrSlug: z.string().min(1).max(150) }),
        response: { 200: dataSchema(productWithPricesSchema) },
      },
    },
    async (req) => ({ data: await getPublicProduct(app.db, req.params.idOrSlug) }),
  );
  app.get(
    '/portal/products',
    {
      preHandler: requireClient,
      schema: {
        tags: ['portal'],
        summary: 'Catalog for the logged-in client',
        response: { 200: catalogResponse },
      },
    },
    async () => ({ data: await publicCatalog(app.db) }),
  );
};

export default routes;

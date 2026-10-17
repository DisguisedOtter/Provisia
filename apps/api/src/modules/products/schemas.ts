import { z } from 'zod';

export {
  createProductGroupSchema,
  createProductSchema,
  dataSchema,
  paginatedSchema,
  productGroupSchema,
  productListQuerySchema,
  productWithPricesSchema,
  updateProductGroupSchema,
  updateProductSchema,
} from '@provisia/shared';

export const idParams = z.object({ id: z.uuid() });

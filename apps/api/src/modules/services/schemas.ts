import { z } from 'zod';

export {
  cancelServiceSchema,
  changeServicePackageResultSchema,
  changeServicePackageSchema,
  createServiceSchema,
  serviceListQuerySchema,
  serviceSchema,
  serviceWithProductSchema,
  updateServiceSchema,
} from '@provisia/shared';

export const serviceIdParams = z.object({ id: z.uuid() });

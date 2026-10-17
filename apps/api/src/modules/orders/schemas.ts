import { z } from 'zod';

export {
  cartItemSchema,
  cartQuoteSchema,
  createOrderSchema,
  guestQuoteRequestSchema,
  guestQuoteSchema,
  orderAcceptResultSchema,
  orderCancelSchema,
  orderListQuerySchema,
  orderQuoteRequestSchema,
  orderSchema,
  orderWithItemsSchema,
} from '@provisia/shared';

export const orderIdParams = z.object({ id: z.uuid() });

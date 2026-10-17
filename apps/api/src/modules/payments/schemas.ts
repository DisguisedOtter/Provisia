import { gatewayIdSchema, paginationQuerySchema, uuidSchema } from '@provisia/shared';
import { z } from 'zod';

export {
  addPaymentMethodSchema,
  autoPaySettingsSchema,
  configureGatewaySchema,
  dataSchema,
  MASKED_SECRET,
  paginatedSchema,
  paginationQuerySchema,
  payInvoiceSchema,
  paymentGatewaySchema,
  paymentIntentSchema,
  paymentMethodSchema,
  paymentStartSchema,
  paymentWebhookEventSchema,
  portalGatewaySchema,
  refundRequestSchema,
  refundResponseSchema,
  setupStartSchema,
  testCredentialsResultSchema,
} from '@provisia/shared';

export const gatewayParamsSchema = z.object({ gateway: gatewayIdSchema });
export const idParamsSchema = z.object({ id: uuidSchema });
export const clientIdParamsSchema = z.object({ clientId: uuidSchema });

export const webhookEventListQuerySchema = paginationQuerySchema.extend({
  gateway: gatewayIdSchema.optional(),
  status: z.enum(['received', 'processed', 'ignored', 'failed']).optional(),
});

export const paymentIntentListQuerySchema = paginationQuerySchema.extend({
  gateway: gatewayIdSchema.optional(),
  status: z.enum(['pending', 'succeeded', 'failed', 'expired']).optional(),
  invoiceId: uuidSchema.optional(),
});

export const webhookAckSchema = z.object({
  received: z.boolean(),
  status: z.enum(['processed', 'ignored', 'duplicate', 'failed']),
  kind: z.string().optional(),
});

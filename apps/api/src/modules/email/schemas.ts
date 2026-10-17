import { z } from 'zod';

export {
  dataSchema,
  emailLocaleSchema,
  emailLogDetailSchema,
  emailLogQuerySchema,
  emailLogSchema,
  emailTemplateKeySchema,
  emailTemplateSchema,
  notificationQuerySchema,
  notificationSchema,
  paginatedSchema,
  previewEmailTemplateSchema,
  renderedEmailSchema,
  smtpTestResultSchema,
  smtpTestSchema,
  testSendEmailSchema,
  upsertEmailTemplateSchema,
} from '@provisia/shared';

export const templateParamsSchema = z.object({
  key: z.string().min(1).max(100),
  locale: z.enum(['en', 'nl']),
});
export const idParamsSchema = z.object({ id: z.uuid() });
export const templateListQuerySchema = z.object({ locale: z.enum(['en', 'nl']).default('en') });
export const unreadCountSchema = z.object({ unread: z.number().int() });

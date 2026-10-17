import { z } from 'zod';

export {
  addWatcherSchema,
  assignTicketSchema,
  cannedResponseSchema,
  createCannedResponseSchema,
  createTicketDepartmentSchema,
  createTicketNoteSchema,
  createTicketReplySchema,
  createTicketSchema,
  dataSchema,
  mergeTicketsSchema,
  paginatedSchema,
  paginationQuerySchema,
  publicTicketDepartmentSchema,
  setTicketStatusSchema,
  ticketAttachmentSchema,
  ticketDepartmentSchema,
  ticketDetailSchema,
  ticketListItemSchema,
  ticketListQuerySchema,
  ticketNoteSchema,
  ticketReplySchema,
  ticketSchema,
  ticketWatcherSchema,
  updateCannedResponseSchema,
  updateTicketDepartmentSchema,
  updateTicketSchema,
} from '@provisia/shared';

export const idParamsSchema = z.object({ id: z.uuid() });
export const ticketSubParamsSchema = z.object({ id: z.uuid(), subId: z.uuid() });
export const cannedQuerySchema = z.object({ departmentId: z.uuid().optional() });
export const mailboxTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  unseen: z.number().int().optional(),
});
export const renderCannedSchema = z.object({ cannedResponseId: z.uuid() });
export const renderedCannedSchema = z.object({ body: z.string() });
/** Portal reply: clients may only close via `status`. */
export const portalReplySchema = z.object({
  body: z.string().min(1).max(50_000),
  attachmentIds: z.array(z.uuid()).max(10).default([]),
  status: z.literal('closed').optional(),
});
export const portalTicketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['open', 'answered', 'customer_reply', 'on_hold', 'closed']).optional(),
  includeClosed: z.coerce.boolean().optional(),
});

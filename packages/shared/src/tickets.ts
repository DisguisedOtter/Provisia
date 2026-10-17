import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const ticketStatusSchema = z.enum(['open', 'answered', 'customer_reply', 'on_hold', 'closed']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

export const ticketDepartmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
  description: z.string().nullable(),
  hidden: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TicketDepartment = z.infer<typeof ticketDepartmentSchema>;

export const ticketAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
});
export type TicketAttachment = z.infer<typeof ticketAttachmentSchema>;

export const ticketSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  clientId: uuidSchema.nullable(),
  departmentId: uuidSchema,
  assignedToUserId: uuidSchema.nullable(),
  subject: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  requesterEmail: z.string().nullable(),
  requesterName: z.string().nullable(),
  lastReplyAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketReplySchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  authorUserId: uuidSchema.nullable(),
  authorEmail: z.string().nullable(),
  authorName: z.string().nullable(),
  isStaff: z.boolean(),
  internal: z.boolean(),
  body: z.string(),
  attachments: z.array(ticketAttachmentSchema),
  createdAt: timestampSchema,
});
export type TicketReply = z.infer<typeof ticketReplySchema>;

export const createTicketSchema = z.object({
  departmentId: uuidSchema,
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(50_000),
  priority: ticketPrioritySchema.default('medium'),
  /** Admin only; portal derives it from the session. */
  clientId: uuidSchema.optional(),
  requesterEmail: emailSchema.optional(),
  requesterName: z.string().max(200).optional(),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const createTicketReplySchema = z.object({
  body: z.string().min(1).max(50_000),
  internal: z.boolean().default(false),
  status: ticketStatusSchema.optional(),
});
export type CreateTicketReply = z.infer<typeof createTicketReplySchema>;

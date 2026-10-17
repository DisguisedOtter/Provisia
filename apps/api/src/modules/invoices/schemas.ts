import { z } from 'zod';

export {
  cancelInvoiceSchema,
  createCreditNoteSchema,
  createInvoiceItemSchema,
  createInvoiceSchema,
  creditNoteSchema,
  creditNoteWithItemsSchema,
  dataSchema,
  invoiceListQuerySchema,
  invoiceSchema,
  invoiceWithItemsSchema,
  markInvoicePaidSchema,
  paginatedSchema,
  paginationQuerySchema,
  sendInvoiceSchema,
  transactionListQuerySchema,
  transactionSchema,
  updateInvoiceItemSchema,
  updateInvoiceSchema,
  uuidSchema,
} from '@provisia/shared';

export const idParams = z.object({ id: z.uuid() });
export const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

export const billingRunSchema = z.object({
  job: z.enum(['generateInvoices', 'dunning', 'lateFees', 'viesRevalidate']),
  clientId: z.uuid().optional(),
  daysAhead: z.number().int().min(0).max(365).optional(),
});

export const issueResultSchema = z.object({
  creditApplied: z.number().int(),
  settled: z.boolean(),
});

export const paymentResultSchema = z.object({
  settled: z.boolean(),
  overpayment: z.number().int(),
});

export const invoiceDetailSchema = z.object({
  // invoiceWithItemsSchema + transactions + balance
  balance: z.number().int(),
});

import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const invoiceStatusSchema = z.enum([
  'draft',
  'unpaid',
  'paid',
  'cancelled',
  'refunded',
  'collections',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Percentages travel as decimal strings (`"21.00"`) to avoid float drift. */
export const percentSchema = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/);

export const invoiceItemSchema = z.object({
  id: uuidSchema,
  invoiceId: uuidSchema,
  description: z.string(),
  quantity: z.number().int(),
  unitAmount: minorUnitsSchema,
  taxRate: percentSchema,
  amount: minorUnitsSchema,
  serviceId: uuidSchema.nullable(),
  domainId: uuidSchema.nullable(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  sortOrder: z.number().int(),
  createdAt: timestampSchema,
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  number: z.string().nullable(),
  status: invoiceStatusSchema,
  issueDate: isoDateSchema.nullable(),
  dueDate: isoDateSchema.nullable(),
  currency: currencyCodeSchema,
  subtotal: minorUnitsSchema,
  taxTotal: minorUnitsSchema,
  creditApplied: minorUnitsSchema,
  total: minorUnitsSchema,
  taxRate: percentSchema,
  reverseCharge: z.boolean(),
  paidAt: timestampSchema.nullable(),
  pdfPath: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceWithItemsSchema = invoiceSchema.extend({ items: z.array(invoiceItemSchema) });
export type InvoiceWithItems = z.infer<typeof invoiceWithItemsSchema>;

export const createInvoiceItemSchema = z.object({
  description: z.string().min(1).max(1000),
  quantity: z.number().int().min(1).default(1),
  unitAmount: minorUnitsSchema,
  taxRate: percentSchema.optional(),
  serviceId: uuidSchema.nullable().optional(),
  domainId: uuidSchema.nullable().optional(),
  periodStart: isoDateSchema.nullable().optional(),
  periodEnd: isoDateSchema.nullable().optional(),
});

export const createInvoiceSchema = z.object({
  clientId: uuidSchema,
  dueDate: isoDateSchema.optional(),
  notes: z.string().nullable().optional(),
  items: z.array(createInvoiceItemSchema).min(1),
});
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;

export const transactionTypeSchema = z.enum(['payment', 'refund', 'credit']);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const transactionSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  invoiceId: uuidSchema.nullable(),
  gateway: z.string(),
  gatewayTxnId: z.string().nullable(),
  type: transactionTypeSchema,
  amount: minorUnitsSchema,
  fee: minorUnitsSchema,
  currency: currencyCodeSchema,
  description: z.string().nullable(),
  createdAt: timestampSchema,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const createTransactionSchema = z.object({
  clientId: uuidSchema,
  invoiceId: uuidSchema.nullable().optional(),
  gateway: z.string().min(1).max(50).default('manual'),
  gatewayTxnId: z.string().max(255).nullable().optional(),
  type: transactionTypeSchema.default('payment'),
  amount: minorUnitsSchema,
  fee: minorUnitsSchema.default(0),
  currency: currencyCodeSchema.default('EUR'),
  description: z.string().nullable().optional(),
});
export type CreateTransaction = z.infer<typeof createTransactionSchema>;

export const creditNoteSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  invoiceId: uuidSchema.nullable(),
  number: z.string(),
  issueDate: isoDateSchema,
  currency: currencyCodeSchema,
  subtotal: minorUnitsSchema,
  taxTotal: minorUnitsSchema,
  total: minorUnitsSchema,
  taxRate: percentSchema,
  reason: z.string().nullable(),
  pdfPath: z.string().nullable(),
  createdAt: timestampSchema,
});
export type CreditNote = z.infer<typeof creditNoteSchema>;

export const taxRuleSchema = z.object({
  id: uuidSchema,
  country: countryCodeSchema,
  eu: z.boolean(),
  rate: percentSchema,
  b2bReverseCharge: z.boolean(),
  validFrom: isoDateSchema,
  createdAt: timestampSchema,
});
export type TaxRule = z.infer<typeof taxRuleSchema>;

export const upsertTaxRuleSchema = taxRuleSchema.omit({ id: true, createdAt: true });

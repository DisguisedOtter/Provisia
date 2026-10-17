import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { paginationQuerySchema } from './pagination.js';

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

/** One row of the per-rate VAT breakdown printed on the invoice. Amounts in minor units. */
export const taxSummaryLineSchema = z.object({
  rate: percentSchema,
  base: minorUnitsSchema,
  tax: minorUnitsSchema,
});
export type TaxSummaryLine = z.infer<typeof taxSummaryLineSchema>;

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
  sentAt: timestampSchema.nullable().optional(),
  lateFeeAppliedAt: timestampSchema.nullable().optional(),
  parentInvoiceId: uuidSchema.nullable().optional(),
  taxSummary: z.array(taxSummaryLineSchema).nullable().optional(),
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
  /** Non-module sources only: gateway bookings come from webhooks, so they can never be forged (and refunded) here. */
  gateway: z.enum(['manual', 'bank_transfer', 'cash', 'other']).default('manual'),
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

export const updateInvoiceItemSchema = createInvoiceItemSchema.partial();
export type UpdateInvoiceItem = z.infer<typeof updateInvoiceItemSchema>;

/** Editable header fields of a draft invoice. */
export const updateInvoiceSchema = z.object({
  dueDate: isoDateSchema.optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  status: invoiceStatusSchema.optional(),
  clientId: uuidSchema.optional(),
  /** Matches the invoice number prefix (`2026-`) or exact number. */
  number: z.string().max(20).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const transactionListQuerySchema = paginationQuerySchema.extend({
  clientId: uuidSchema.optional(),
  invoiceId: uuidSchema.optional(),
  gateway: z.string().max(50).optional(),
  type: transactionTypeSchema.optional(),
});
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

/** Admin: record a payment against an invoice (manual / bank transfer). Defaults to the open balance. */
export const markInvoicePaidSchema = z.object({
  amount: minorUnitsSchema.positive().optional(),
  gateway: z.string().min(1).max(50).default('manual'),
  gatewayTxnId: z.string().max(255).nullable().optional(),
  fee: minorUnitsSchema.min(0).default(0),
  description: z.string().max(500).nullable().optional(),
  paidAt: timestampSchema.optional(),
});
export type MarkInvoicePaid = z.infer<typeof markInvoicePaidSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});

export const createCreditNoteSchema = z.object({
  reason: z.string().min(1).max(500),
  /** Omit to credit the full invoice. Partial credit notes list the items to reverse. */
  items: z.array(createInvoiceItemSchema).min(1).optional(),
  /** Book the credited amount onto the client's credit balance (default) or just register the note. */
  addToCreditBalance: z.boolean().default(true),
});
export type CreateCreditNote = z.infer<typeof createCreditNoteSchema>;

export const creditNoteWithItemsSchema = creditNoteSchema.extend({
  items: z.array(invoiceItemSchema.omit({ invoiceId: true }).extend({ creditNoteId: uuidSchema })),
});

/** Manual credit balance change; negative amounts debit the balance. */
export const creditAdjustmentSchema = z.object({
  amount: minorUnitsSchema.refine((n) => n !== 0, 'amount must not be zero'),
  description: z.string().min(1).max(500),
});
export type CreditAdjustment = z.infer<typeof creditAdjustmentSchema>;

export const creditAdjustmentResultSchema = z.object({
  transaction: transactionSchema,
  creditBalance: minorUnitsSchema,
});

/** Result of a VIES lookup as cached on the client. */
export const vatValidationResultSchema = z.object({
  valid: z.boolean(),
  countryCode: z.string(),
  vatNumber: z.string(),
  name: z.string().nullable(),
  address: z.string().nullable(),
  requestIdentifier: z.string().nullable(),
  checkedAt: timestampSchema,
  /** VIES was unreachable; `valid` is then the previous cached value (or false). */
  unavailable: z.boolean().default(false),
});
export type VatValidationResult = z.infer<typeof vatValidationResultSchema>;

export const sendInvoiceSchema = z.object({
  /** Override recipient; defaults to the client's primary email plus contacts flagged for invoices. */
  to: z.string().email().optional(),
});

/** Explains how an invoice total was taxed; also used for cart previews. */
export const taxDecisionSchema = z.object({
  ratePercent: z.number(),
  rate: percentSchema,
  reverseCharge: z.boolean(),
  kind: z.enum(['domestic', 'eu_b2c', 'eu_reverse_charge', 'export', 'exempt']),
  euMember: z.boolean(),
  note: z.object({ en: z.string(), nl: z.string() }).nullable(),
});
export type TaxDecision = z.infer<typeof taxDecisionSchema>;

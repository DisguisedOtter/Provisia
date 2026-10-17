import {
  addInvoiceItem,
  cancelInvoice,
  createCreditNote,
  createDraftInvoice,
  deleteInvoiceItem,
  getCreditNote,
  getInvoice,
  invoiceTransactions,
  issueInvoice,
  openAmount,
  updateDraftInvoice,
  updateInvoiceItem,
} from '@provisia/core/db';
import { enqueue } from '@provisia/worker/queues';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission } from '../../lib/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import {
  billingRunSchema,
  cancelInvoiceSchema,
  createCreditNoteSchema,
  createInvoiceItemSchema,
  createInvoiceSchema,
  creditNoteSchema,
  creditNoteWithItemsSchema,
  dataSchema,
  idParams,
  invoiceListQuerySchema,
  invoiceWithItemsSchema,
  issueResultSchema,
  itemParams,
  markInvoicePaidSchema,
  paginatedSchema,
  paginationQuerySchema,
  paymentResultSchema,
  sendInvoiceSchema,
  transactionListQuerySchema,
  transactionSchema,
  updateInvoiceItemSchema,
  updateInvoiceSchema,
  uuidSchema,
} from './schemas.js';
import {
  creditNotePdf,
  invoicePdf,
  listCreditNotes,
  listInvoices,
  listTransactions,
  payInvoice,
  withBilling,
} from './service.js';

const READ = requirePermission('invoices.read');
const WRITE = requirePermission('invoices.write');
const tags = ['invoices'];

const invoiceDetailSchema = invoiceWithItemsSchema.extend({
  transactions: z.array(transactionSchema),
  balance: z.number().int(),
});

const routes: FastifyPluginAsyncZod = async (app) => {
  const detail = async (id: string) => {
    const inv = await withBilling(() => getInvoice(app.db, id));
    const txns = await invoiceTransactions(app.db, id);
    return { ...inv, transactions: txns, balance: await openAmount(app.db, inv) };
  };
  const ownClientId = (req: { auth: { user: { clientId: string | null } } | null }) => {
    const clientId = req.auth?.user.clientId;
    if (!clientId) throw forbidden('No client account linked to this user');
    return clientId;
  };

  // ------------------------------------------------------------------ admin: invoices
  app.get(
    '/admin/invoices',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'List invoices',
        querystring: invoiceListQuerySchema,
        response: { 200: paginatedSchema(invoiceWithItemsSchema.omit({ items: true })) },
      },
    },
    async (req) => listInvoices(app.db, req.query),
  );

  app.post(
    '/admin/invoices',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Create a manual draft invoice',
        body: createInvoiceSchema,
        response: { 201: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req, reply) => {
      const inv = await withBilling(() =>
        createDraftInvoice(app.db, {
          clientId: req.body.clientId,
          dueDate: req.body.dueDate ?? null,
          notes: req.body.notes ?? null,
          items: req.body.items,
        }),
      );
      await activityLog(req, {
        action: 'invoice.create',
        entityType: 'invoice',
        entityId: inv.id,
        diff: { clientId: inv.clientId, total: inv.total },
      });
      return reply.status(201).send({ data: inv });
    },
  );

  app.get(
    '/admin/invoices/:id',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'Invoice with lines, transactions and open balance',
        params: idParams,
        response: { 200: dataSchema(invoiceDetailSchema) },
      },
    },
    async (req) => ({ data: await detail(req.params.id) }),
  );

  app.patch(
    '/admin/invoices/:id',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Edit due date / notes of a draft',
        params: idParams,
        body: updateInvoiceSchema,
        response: { 200: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req) => {
      const inv = await withBilling(() => updateDraftInvoice(app.db, req.params.id, req.body));
      await activityLog(req, {
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: inv.id,
        diff: req.body,
      });
      return { data: inv };
    },
  );

  app.post(
    '/admin/invoices/:id/items',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Add a line to a draft',
        params: idParams,
        body: createInvoiceItemSchema,
        response: { 201: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req, reply) => {
      const inv = await withBilling(() => addInvoiceItem(app.db, req.params.id, req.body));
      await activityLog(req, {
        action: 'invoice.item.add',
        entityType: 'invoice',
        entityId: inv.id,
        diff: req.body,
      });
      return reply.status(201).send({ data: inv });
    },
  );

  app.patch(
    '/admin/invoices/:id/items/:itemId',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Edit a draft line',
        params: itemParams,
        body: updateInvoiceItemSchema,
        response: { 200: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req) => {
      const inv = await withBilling(() =>
        updateInvoiceItem(app.db, req.params.id, req.params.itemId, req.body),
      );
      await activityLog(req, {
        action: 'invoice.item.update',
        entityType: 'invoice',
        entityId: inv.id,
        diff: { itemId: req.params.itemId, ...req.body },
      });
      return { data: inv };
    },
  );

  app.delete(
    '/admin/invoices/:id/items/:itemId',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Remove a draft line',
        params: itemParams,
        response: { 200: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req) => {
      const inv = await withBilling(() =>
        deleteInvoiceItem(app.db, req.params.id, req.params.itemId),
      );
      await activityLog(req, {
        action: 'invoice.item.delete',
        entityType: 'invoice',
        entityId: inv.id,
        diff: { itemId: req.params.itemId },
      });
      return { data: inv };
    },
  );

  app.post(
    '/admin/invoices/:id/issue',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Issue: assigns the next gap-free number, applies credit, locks the invoice',
        params: idParams,
        response: { 200: dataSchema(invoiceWithItemsSchema.extend(issueResultSchema.shape)) },
      },
    },
    async (req) => {
      const result = await withBilling(() => issueInvoice(app.db, req.params.id));
      await activityLog(req, {
        action: 'invoice.issue',
        entityType: 'invoice',
        entityId: result.invoice.id,
        diff: {
          number: result.invoice.number,
          creditApplied: result.creditApplied,
          settled: result.settled,
        },
      });
      await enqueue(
        'billing',
        'sendInvoice',
        { invoiceId: result.invoice.id, templateKey: 'invoice.created' },
        { jobId: `invoice-${result.invoice.id}-created` },
      ).catch((err) => req.log.warn({ err }, 'could not enqueue invoice email'));
      return {
        data: { ...result.invoice, creditApplied: result.creditApplied, settled: result.settled },
      };
    },
  );

  app.post(
    '/admin/invoices/:id/pay',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Record a (manual) payment; overpayment becomes credit',
        params: idParams,
        body: markInvoicePaidSchema,
        response: {
          200: dataSchema(
            invoiceWithItemsSchema
              .extend(paymentResultSchema.shape)
              .extend({ transaction: transactionSchema }),
          ),
        },
      },
    },
    async (req) => {
      const inv = await withBilling(() => getInvoice(app.db, req.params.id));
      const amount = req.body.amount ?? (await openAmount(app.db, inv));
      const result = await payInvoice(app.db, req.params.id, {
        amount,
        gateway: req.body.gateway,
        gatewayTxnId: req.body.gatewayTxnId ?? null,
        fee: req.body.fee,
        description: req.body.description ?? null,
        now: req.body.paidAt,
      });
      await activityLog(req, {
        action: 'invoice.pay',
        entityType: 'invoice',
        entityId: inv.id,
        diff: {
          amount,
          gateway: req.body.gateway,
          settled: result.settled,
          overpayment: result.overpayment,
        },
      });
      return {
        data: {
          ...result.invoice,
          settled: result.settled,
          overpayment: result.overpayment,
          transaction: result.transaction,
        },
      };
    },
  );

  app.post(
    '/admin/invoices/:id/cancel',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Cancel a draft/unpaid invoice (number is never reused)',
        params: idParams,
        body: cancelInvoiceSchema.nullish(),
        response: { 200: dataSchema(invoiceWithItemsSchema) },
      },
    },
    async (req) => {
      const inv = await withBilling(() =>
        cancelInvoice(app.db, req.params.id, { reason: req.body?.reason ?? null }),
      );
      await activityLog(req, {
        action: 'invoice.cancel',
        entityType: 'invoice',
        entityId: inv.id,
        diff: { reason: req.body?.reason ?? null },
      });
      return { data: inv };
    },
  );

  app.post(
    '/admin/invoices/:id/credit-note',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Issue a credit note (CN-YYYY-NNNNNN) against a paid invoice',
        params: idParams,
        body: createCreditNoteSchema,
        response: { 201: dataSchema(creditNoteWithItemsSchema) },
      },
    },
    async (req, reply) => {
      const note = await withBilling(() =>
        createCreditNote(app.db, req.params.id, {
          reason: req.body.reason,
          items: req.body.items,
          addToCreditBalance: req.body.addToCreditBalance,
        }),
      );
      await activityLog(req, {
        action: 'invoice.credit_note',
        entityType: 'invoice',
        entityId: req.params.id,
        diff: { creditNoteId: note.id, number: note.number, total: note.total },
      });
      return reply.status(201).send({ data: note });
    },
  );

  app.get(
    '/admin/invoices/:id/pdf',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'Download the invoice PDF (rendered on demand, stored for issued invoices)',
        params: idParams,
      },
    },
    async (req, reply) => {
      const { buffer, filename } = await withBilling(() => invoicePdf(app.db, req.params.id));
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );

  app.post(
    '/admin/invoices/:id/send',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary: 'Email the invoice (with PDF) via the email queue',
        params: idParams,
        body: sendInvoiceSchema.nullish(),
        response: { 202: z.object({ data: z.object({ queued: z.boolean() }) }) },
      },
    },
    async (req, reply) => {
      const inv = await withBilling(() => getInvoice(app.db, req.params.id));
      if (inv.status === 'draft') throw forbidden('Issue the invoice before sending it');
      await enqueue('billing', 'sendInvoice', {
        invoiceId: inv.id,
        templateKey: inv.status === 'paid' ? 'invoice.paid' : 'invoice.created',
        to: req.body?.to,
      });
      await activityLog(req, {
        action: 'invoice.send',
        entityType: 'invoice',
        entityId: inv.id,
        diff: { to: req.body?.to ?? null },
      });
      return reply.status(202).send({ data: { queued: true } });
    },
  );

  // ------------------------------------------------------------------ admin: credit notes, transactions, runs
  app.get(
    '/admin/credit-notes',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'List credit notes',
        querystring: paginationQuerySchema.extend({
          clientId: uuidSchema.optional(),
          invoiceId: uuidSchema.optional(),
        }),
        response: { 200: paginatedSchema(creditNoteSchema) },
      },
    },
    async (req) => listCreditNotes(app.db, req.query),
  );
  app.get(
    '/admin/credit-notes/:id',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'Credit note with lines',
        params: idParams,
        response: { 200: dataSchema(creditNoteWithItemsSchema) },
      },
    },
    async (req) => ({ data: await withBilling(() => getCreditNote(app.db, req.params.id)) }),
  );
  app.get(
    '/admin/credit-notes/:id/pdf',
    {
      preHandler: READ,
      schema: { tags, summary: 'Download the credit note PDF', params: idParams },
    },
    async (req, reply) => {
      const { buffer, filename } = await withBilling(() => creditNotePdf(app.db, req.params.id));
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );

  app.get(
    '/admin/transactions',
    {
      preHandler: READ,
      schema: {
        tags,
        summary: 'List transactions (payments, refunds, credit)',
        querystring: transactionListQuerySchema,
        response: { 200: paginatedSchema(transactionSchema) },
      },
    },
    async (req) => listTransactions(app.db, req.query),
  );

  app.post(
    '/admin/billing/run',
    {
      preHandler: WRITE,
      schema: {
        tags,
        summary:
          'Trigger a billing job now (invoice generation, dunning, late fees, VIES re-validation)',
        body: billingRunSchema,
        response: {
          202: z.object({ data: z.object({ job: z.string(), jobId: z.string().nullable() }) }),
        },
      },
    },
    async (req, reply) => {
      const { job, clientId, daysAhead } = req.body;
      const data = job === 'generateInvoices' ? { clientId, daysAhead } : {};
      const queued = await enqueue('billing', job, data as never);
      await activityLog(req, { action: 'billing.run', entityType: 'billing', diff: req.body });
      return reply.status(202).send({ data: { job, jobId: queued.id ?? null } });
    },
  );

  // ------------------------------------------------------------------ portal
  app.get(
    '/portal/invoices',
    {
      preHandler: requireClient,
      schema: {
        tags,
        summary: 'My invoices',
        querystring: invoiceListQuerySchema.omit({ clientId: true }),
        response: { 200: paginatedSchema(invoiceWithItemsSchema.omit({ items: true })) },
      },
    },
    async (req) => listInvoices(app.db, req.query, { clientId: ownClientId(req) }),
  );

  app.get(
    '/portal/invoices/:id',
    {
      preHandler: requireClient,
      schema: {
        tags,
        summary: 'One of my invoices',
        params: idParams,
        response: { 200: dataSchema(invoiceDetailSchema) },
      },
    },
    async (req) => {
      const inv = await detail(req.params.id);
      if (inv.clientId !== ownClientId(req) || inv.status === 'draft') throw notFound('Invoice');
      return { data: inv };
    },
  );

  app.get(
    '/portal/invoices/:id/pdf',
    {
      preHandler: requireClient,
      schema: { tags, summary: 'Download one of my invoices as PDF', params: idParams },
    },
    async (req, reply) => {
      const inv = await withBilling(() => getInvoice(app.db, req.params.id));
      if (inv.clientId !== ownClientId(req) || inv.status === 'draft') throw notFound('Invoice');
      const { buffer, filename } = await invoicePdf(app.db, inv.id);
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );

  app.get(
    '/portal/credit-notes',
    {
      preHandler: requireClient,
      schema: {
        tags,
        summary: 'My credit notes',
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(creditNoteSchema) },
      },
    },
    async (req) => listCreditNotes(app.db, req.query, { clientId: ownClientId(req) }),
  );
  app.get(
    '/portal/credit-notes/:id/pdf',
    {
      preHandler: requireClient,
      schema: { tags, summary: 'Download one of my credit notes as PDF', params: idParams },
    },
    async (req, reply) => {
      const note = await withBilling(() => getCreditNote(app.db, req.params.id));
      if (note.clientId !== ownClientId(req)) throw notFound('Credit note');
      const { buffer, filename } = await creditNotePdf(app.db, note.id);
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );
};

export default routes;

/**
 * Billing jobs (billing agent). All business logic lives in `@provisia/core/db`; this file only schedules,
 * enqueues side effects (emails, provisioning) and reports. Every job is idempotent: re-running after a
 * crash never double-invoices (unique (service, period)), double-reminds (step markers) or double-suspends
 * (deterministic job ids).
 */
import {
  createFakeViesClient,
  createViesRestClient,
  dunningSettingsFrom,
  paidAmount,
} from '@provisia/core';
import {
  generateRecurringInvoices,
  getInvoice,
  invoiceTransactions,
  loadSettings,
  resolveStorageRoot,
  revalidateVatNumbers,
  runDunning,
  storeInvoicePdf,
} from '@provisia/core/db';
import { clientContacts, clients, type Db, invoices, users } from '@provisia/db';
import type { EmailSendJob, InvoiceEmailData, Settings } from '@provisia/shared';
import { and, eq } from 'drizzle-orm';
import type { JobContext, JobHandler } from '../context.js';
import { enqueue, type JobData } from '../queues.js';

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

async function invoiceRecipients(db: Db, clientId: string) {
  const [primary] = await db
    .select({
      email: users.email,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      companyName: clients.companyName,
      language: clients.language,
    })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId));
  if (!primary) return null;
  const cc = await db
    .select({ email: clientContacts.email })
    .from(clientContacts)
    .where(
      and(eq(clientContacts.clientId, clientId), eq(clientContacts.receivesInvoiceEmails, true)),
    );
  return { ...primary, cc: cc.map((c) => c.email).filter((e) => e !== primary.email) };
}

async function invoiceEmailData(
  db: Db,
  invoiceId: string,
  webUrl: string,
): Promise<{ data: InvoiceEmailData; clientId: string } | null> {
  const inv = await getInvoice(db, invoiceId);
  const rec = await invoiceRecipients(db, inv.clientId);
  if (!rec) return null;
  const paid = paidAmount(await invoiceTransactions(db, invoiceId));
  return {
    clientId: inv.clientId,
    data: {
      client: { firstName: rec.firstName, lastName: rec.lastName, companyName: rec.companyName },
      invoice: {
        id: inv.id,
        number: inv.number ?? '',
        issueDate: inv.issueDate ?? '',
        dueDate: inv.dueDate ?? '',
        total: { amount: inv.total, currency: inv.currency },
        balance: { amount: Math.max(0, inv.total - paid), currency: inv.currency },
        status: inv.status,
      },
      invoiceUrl: `${webUrl}/portal/invoices/${inv.id}`,
      payUrl: `${webUrl}/portal/invoices/${inv.id}/pay`,
    },
  };
}

async function ensurePdf(
  ctx: JobContext,
  invoiceId: string,
  settings: Settings,
): Promise<{ path: string; absolutePath: string } | null> {
  try {
    const stored = await storeInvoicePdf(ctx.db, invoiceId, {
      storageRoot: resolveStorageRoot(process.env.STORAGE_PATH, settings),
      settings,
    });
    return stored;
  } catch (err) {
    ctx.logger.error(
      { err, invoiceId },
      'invoice pdf rendering failed; sending without attachment',
    );
    return null;
  }
}

/** Sends an invoice-related template to the client (+ invoice contacts), attaching the PDF when available. */
async function sendInvoiceEmail(
  ctx: JobContext,
  invoiceId: string,
  key:
    | 'invoice.created'
    | 'invoice.paid'
    | 'invoice.reminder'
    | 'invoice.overdue'
    | 'invoice.late_fee',
  extra: Record<string, unknown> = {},
  opts: { to?: string; jobId?: string; attachPdf?: boolean } = {},
): Promise<boolean> {
  const built = await invoiceEmailData(ctx.db, invoiceId, ctx.webUrl);
  if (!built) return false;
  const rec = await invoiceRecipients(ctx.db, built.clientId);
  if (!rec) return false;
  const settings = await loadSettings(ctx.db);
  const pdf = opts.attachPdf === false ? null : await ensurePdf(ctx, invoiceId, settings);
  const payload: EmailSendJob = {
    key,
    to: opts.to ?? rec.email,
    toName: `${rec.firstName} ${rec.lastName}`.trim(),
    toUserId: rec.userId,
    cc: opts.to ? undefined : rec.cc.slice(0, 10),
    locale: rec.language,
    data: { ...built.data, ...extra } as unknown as Record<string, unknown>,
    attachments: pdf
      ? [
          {
            filename: `${built.data.invoice.number || 'invoice'}.pdf`,
            path: pdf.absolutePath,
            contentType: 'application/pdf',
          },
        ]
      : undefined,
    related: { type: 'invoice', id: invoiceId },
  };
  await enqueue('email', 'send', payload, opts.jobId ? { jobId: opts.jobId } : undefined);
  if (key === 'invoice.created') {
    await ctx.db.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, invoiceId));
  }
  return true;
}

function viesClient(settings: Settings) {
  if (process.env.VIES_FAKE === '1' || process.env.NODE_ENV === 'test')
    return createFakeViesClient();
  const requester =
    settings['company.vatNumber'] && settings['company.country']
      ? {
          countryCode: settings['company.country'],
          vatNumber: settings['company.vatNumber'].replace(/^[A-Z]{2}/i, ''),
        }
      : undefined;
  return createViesRestClient({ requester });
}

// ---------------------------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------------------------

/** Daily: invoices for services due within `billing.invoiceDaysBeforeDue`, one per client, emailed with PDF. */
export const generateInvoices: JobHandler<JobData<'billing', 'generateInvoices'>> = async (
  ctx,
  data,
) => {
  const result = await generateRecurringInvoices(ctx.db, {
    clientId: data.clientId,
    daysAhead: data.daysAhead,
  });
  let emailed = 0;
  for (const inv of result.created) {
    const ok = await sendInvoiceEmail(
      ctx,
      inv.invoiceId,
      'invoice.created',
      {},
      { jobId: `invoice-${inv.invoiceId}-created` },
    );
    if (ok) emailed += 1;
  }
  ctx.logger.info(
    { created: result.created.length, skipped: result.skipped.length, horizon: result.horizon },
    'recurring invoices generated',
  );
  return {
    horizon: result.horizon,
    created: result.created.map((c) => ({
      invoiceId: c.invoiceId,
      number: c.number,
      total: c.total,
    })),
    skipped: result.skipped,
    emailed,
  };
};

/** Daily: reminders / suspend / terminate. Late fees run separately (`lateFees`) so they can be scheduled apart. */
export const dunning: JobHandler<JobData<'billing', 'dunning'>> = async (ctx) => {
  const settings = dunningSettingsFrom(await loadSettings(ctx.db));
  const effects = await runDunning(ctx.db, {
    settings: { ...settings, lateFee: { type: 'none', value: 0 } },
  });
  for (const e of effects.emails) {
    await sendInvoiceEmail(
      ctx,
      e.invoiceId,
      e.templateKey,
      { daysOverdue: e.daysOverdue, step: e.step, suspendDate: undefined },
      { jobId: `invoice-${e.invoiceId}-reminder-${e.step}`, attachPdf: e.step === 1 },
    );
  }
  for (const s of effects.suspend) {
    await enqueue(
      'provisioning',
      'suspend',
      { serviceId: s.serviceId, reason: s.reason },
      { jobId: `dunning-suspend-${s.serviceId}-${s.invoiceId}` },
    );
  }
  for (const t of effects.terminate) {
    await enqueue(
      'provisioning',
      'terminate',
      { serviceId: t.serviceId },
      { jobId: `dunning-terminate-${t.serviceId}-${t.invoiceId}` },
    );
  }
  ctx.logger.info(
    {
      evaluated: effects.evaluated,
      emails: effects.emails.length,
      suspend: effects.suspend.length,
      terminate: effects.terminate.length,
    },
    'dunning run complete',
  );
  return {
    evaluated: effects.evaluated,
    emails: effects.emails.length,
    suspend: effects.suspend.map((s) => s.serviceId),
    terminate: effects.terminate.map((t) => t.serviceId),
  };
};

/** Daily: charges the configured late fee (separate invoice) once per overdue invoice, emails `invoice.late_fee`. */
export const lateFees: JobHandler<JobData<'billing', 'lateFees'>> = async (ctx) => {
  const settings = dunningSettingsFrom(await loadSettings(ctx.db));
  if (settings.lateFee.type === 'none') return { skipped: 'late fees disabled' };
  const effects = await runDunning(ctx.db, {
    settings: { ...settings, reminderDays: [], suspendAfterDays: 0, terminateAfterDays: 0 },
  });
  for (const fee of effects.lateFees) {
    await sendInvoiceEmail(
      ctx,
      fee.feeInvoiceId,
      'invoice.late_fee',
      { lateFee: { amount: fee.amount, currency: 'EUR' }, originalInvoiceId: fee.invoiceId },
      { jobId: `invoice-${fee.feeInvoiceId}-late_fee` },
    );
  }
  return { evaluated: effects.evaluated, lateFees: effects.lateFees };
};

/** Monthly: re-check cached VIES results older than 30 days; flips reverse-charge eligibility when a number lapses. */
export const viesRevalidate: JobHandler<JobData<'billing', 'viesRevalidate'>> = async (
  ctx,
  data,
) => {
  const settings = await loadSettings(ctx.db);
  if (settings['tax.viesValidation'] === false) return { skipped: 'VIES validation disabled' };
  const result = await revalidateVatNumbers(ctx.db, viesClient(settings), {
    olderThanDays: data.olderThanDays ?? 30,
  });
  if (result.changed.length > 0)
    ctx.logger.warn({ changed: result.changed }, 'VAT validity changed for clients');
  return result;
};

/** On demand: (re)render and store the PDF of an invoice. */
export const renderInvoicePdf: JobHandler<JobData<'billing', 'renderInvoicePdf'>> = async (
  ctx,
  data,
) => {
  const settings = await loadSettings(ctx.db);
  const stored = await storeInvoicePdf(ctx.db, data.invoiceId, {
    storageRoot: resolveStorageRoot(process.env.STORAGE_PATH, settings),
    settings,
  });
  return { path: stored.path };
};

/** On demand (API "send" button, payment confirmations): email an invoice with its PDF. */
export const sendInvoice: JobHandler<JobData<'billing', 'sendInvoice'>> = async (ctx, data) => {
  const ok = await sendInvoiceEmail(
    ctx,
    data.invoiceId,
    data.templateKey ?? 'invoice.created',
    data.templateKey === 'invoice.paid' ? { paidAt: new Date().toISOString() } : {},
    { to: data.to },
  );
  return { sent: ok };
};

export const billingJobs = {
  generateInvoices,
  dunning,
  lateFees,
  viesRevalidate,
  renderInvoicePdf,
  sendInvoice,
};

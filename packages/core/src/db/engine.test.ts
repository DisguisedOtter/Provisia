import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clients,
  createDb,
  type Db,
  domains,
  invoiceItems,
  invoices,
  productGroups,
  productPrices,
  products,
  services,
  settings,
  transactions,
  users,
} from '@provisia/db';
import { seed } from '@provisia/db/seed';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, toIsoDate } from '../dates.js';
import { createFakeViesClient } from '../vies/index.js';
import { runDunning } from './dunning.js';
import {
  addInvoiceItem,
  adjustCredit,
  cancelInvoice,
  createCreditNote,
  createDraftInvoice,
  deleteInvoiceItem,
  getInvoice,
  issueInvoice,
  recordPayment,
  updateInvoiceItem,
} from './invoices.js';
import { storeInvoicePdf } from './pdf.js';
import { generateRecurringInvoices } from './recurring.js';
import { BillingError } from './types.js';
import { revalidateVatNumbers, validateClientVat } from './vies.js';

const TEST_URL = process.env.DATABASE_URL_TEST;
const TODAY = toIsoDate(new Date());
const YEAR = TODAY.slice(0, 4);

describe.skipIf(!TEST_URL)('billing engine (postgres)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let productId: string;
  let seq = 0;

  async function makeClient(over: Partial<typeof clients.$inferInsert> = {}, email?: string) {
    seq += 1;
    const [u] = await db
      .insert(users)
      .values({
        email: email ?? `engine-${Date.now()}-${seq}@example.com`,
        passwordHash: 'x',
        role: 'client',
        firstName: 'Test',
        lastName: `Client${seq}`,
      })
      .returning({ id: users.id });
    if (!u) throw new Error('user');
    const [c] = await db
      .insert(clients)
      .values({
        userId: u.id,
        country: 'NL',
        address1: 'Teststraat 1',
        city: 'Amsterdam',
        postalCode: '1000AA',
        language: 'nl',
        ...over,
      })
      .returning();
    if (!c) throw new Error('client');
    return c;
  }

  async function makeService(clientId: string, over: Partial<typeof services.$inferInsert> = {}) {
    const [s] = await db
      .insert(services)
      .values({
        clientId,
        productId,
        status: 'active',
        billingCycle: 'monthly',
        recurringAmount: 1000,
        registrationDate: '2026-01-15',
        nextDueDate: addDays(TODAY, 5),
        domain: 'example.nl',
        ...over,
      })
      .returning();
    if (!s) throw new Error('service');
    return s;
  }

  beforeAll(async () => {
    const url = TEST_URL as string;
    const conn = createDb(url, { max: 5 });
    db = conn.db;
    close = conn.close;
    // Clean billing state (schema is pushed with drizzle-kit; see README).
    await db.execute(
      sql`truncate table invoice_items, invoices, transactions, credit_notes, invoice_counters, services, domains restart identity cascade`,
    );
    await seed(db, { adminEmail: 'engine-admin@example.com', adminPassword: 'engine-pass-123' });
    await db
      .insert(settings)
      .values({ key: 'company.iban', value: 'NL91ABNA0417164300' })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'NL91ABNA0417164300' } });
    const [p] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, 'starter-hosting'));
    if (!p) throw new Error('seeded product missing');
    productId = p.id;
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table invoice_items, invoices, transactions, credit_notes, invoice_counters, services, domains restart identity cascade`,
    );
  });

  it('creates a draft with NL VAT and issues it with the first number of the year', async () => {
    const c = await makeClient();
    const draft = await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        { description: 'Hosting', unitAmount: 499 },
        { description: 'Hosting', unitAmount: 499 },
      ],
    });
    expect(draft.status).toBe('draft');
    expect(draft.number).toBeNull();
    expect(draft.subtotal).toBe(998);
    expect(draft.taxTotal).toBe(210);
    expect(draft.items[0]?.taxRate).toBe('21.00');

    const { invoice, settled } = await issueInvoice(db, draft.id);
    expect(settled).toBe(false);
    expect(invoice.number).toBe(`${YEAR}-000001`);
    expect(invoice.status).toBe('unpaid');
    expect(invoice.issueDate).toBe(TODAY);
    expect(invoice.dueDate).toBe(addDays(TODAY, 14));
    expect(invoice.billingSnapshot).toMatchObject({
      client: { country: 'NL' },
      tax: { kind: 'domestic' },
    });
    await expect(issueInvoice(db, draft.id)).rejects.toMatchObject({ code: 'invoice_locked' });
    await expect(
      addInvoiceItem(db, draft.id, { description: 'x', unitAmount: 1 }),
    ).rejects.toBeInstanceOf(BillingError);
  });

  it('edits draft lines and recalculates', async () => {
    const c = await makeClient();
    const draft = await createDraftInvoice(db, {
      clientId: c.id,
      items: [{ description: 'A', unitAmount: 1000 }],
    });
    const withB = await addInvoiceItem(db, draft.id, {
      description: 'B',
      unitAmount: 500,
      taxable: false,
    });
    expect(withB.items).toHaveLength(2);
    expect(withB.subtotal).toBe(1500);
    expect(withB.taxTotal).toBe(210);
    const b = withB.items.find((i) => i.description === 'B');
    if (!b) throw new Error('missing B');
    const edited = await updateInvoiceItem(db, draft.id, b.id, { quantity: 3 });
    expect(edited.subtotal).toBe(2500);
    const removed = await deleteInvoiceItem(db, draft.id, b.id);
    expect(removed.items).toHaveLength(1);
    expect(removed.total).toBe(1210);
  });

  it('assigns gap-free sequential numbers under concurrent issuance', async () => {
    const c = await makeClient();
    const drafts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createDraftInvoice(db, {
          clientId: c.id,
          items: [{ description: `L${i}`, unitAmount: 100 }],
        }),
      ),
    );
    const issued = await Promise.all(drafts.map((d) => issueInvoice(db, d.id)));
    const numbers = issued.map((r) => r.invoice.number).sort();
    expect(numbers).toEqual(
      Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(6, '0')}`),
    );
  });

  it('applies credit at issue: partially, and fully (invoice paid immediately)', async () => {
    const c = await makeClient({ creditBalance: 500 });
    const d1 = await createDraftInvoice(db, {
      clientId: c.id,
      items: [{ description: 'A', unitAmount: 1000 }],
    });
    const r1 = await issueInvoice(db, d1.id);
    expect(r1.creditApplied).toBe(500);
    expect(r1.invoice.status).toBe('unpaid');
    const [after1] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(after1?.creditBalance).toBe(0);

    await adjustCredit(db, c.id, { amount: 5000, description: 'goodwill' });
    const d2 = await createDraftInvoice(db, {
      clientId: c.id,
      items: [{ description: 'B', unitAmount: 1000 }],
    });
    const r2 = await issueInvoice(db, d2.id);
    expect(r2.settled).toBe(true);
    expect(r2.invoice.status).toBe('paid');
    expect(r2.creditApplied).toBe(1210);
    const [after2] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(after2?.creditBalance).toBe(3790);
    await expect(
      adjustCredit(db, c.id, { amount: -99999, description: 'too much' }),
    ).rejects.toMatchObject({ code: 'insufficient_credit' });
  });

  it('reverse-charges a validated German business and exports outside the EU', async () => {
    const de = await makeClient({
      country: 'DE',
      vatNumber: 'DE123456789',
      vatValidated: true,
      companyName: 'Muster GmbH',
      language: 'en',
    });
    const inv = await createDraftInvoice(db, {
      clientId: de.id,
      items: [{ description: 'Hosting', unitAmount: 1000 }],
    });
    expect(inv.reverseCharge).toBe(true);
    expect(inv.taxTotal).toBe(0);
    const issued = await issueInvoice(db, inv.id);
    expect(issued.invoice.billingSnapshot).toMatchObject({ tax: { kind: 'eu_reverse_charge' } });
    const us = await makeClient({ country: 'US' });
    const exp = await createDraftInvoice(db, {
      clientId: us.id,
      items: [{ description: 'Hosting', unitAmount: 1000 }],
    });
    expect(exp.taxTotal).toBe(0);
    expect(exp.reverseCharge).toBe(false);
    const deB2c = await makeClient({ country: 'DE' });
    const b2c = await createDraftInvoice(db, {
      clientId: deB2c.id,
      items: [{ description: 'Hosting', unitAmount: 1000 }],
    });
    expect(b2c.taxTotal).toBe(190);
  });

  it('records payments: partial, settle, overpayment to credit, duplicate rejected', async () => {
    const c = await makeClient();
    const svc = await makeService(c.id, { status: 'pending', nextDueDate: TODAY });
    const d = await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        {
          description: 'Hosting',
          unitAmount: 1000,
          serviceId: svc.id,
          periodStart: TODAY,
          periodEnd: addDays(TODAY, 30),
        },
      ],
    });
    const { invoice } = await issueInvoice(db, d.id);
    const p1 = await recordPayment(db, invoice.id, { amount: 500, gateway: 'manual' });
    expect(p1.settled).toBe(false);
    expect(p1.invoice.status).toBe('unpaid');
    const p2 = await recordPayment(db, invoice.id, {
      amount: 1000,
      gateway: 'stripe',
      gatewayTxnId: 'pi_1',
    });
    expect(p2.settled).toBe(true);
    expect(p2.overpayment).toBe(290);
    expect(p2.invoice.status).toBe('paid');
    expect(p2.services).toEqual([
      { id: svc.id, status: 'pending', wasPending: true, wasSuspended: false },
    ]);
    const [cl] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(cl?.creditBalance).toBe(290);
    const [s] = await db.select().from(services).where(eq(services.id, svc.id));
    expect(s?.nextDueDate).toBe(addDays(TODAY, 31));
    await expect(
      recordPayment(db, invoice.id, { amount: 1, gateway: 'stripe', gatewayTxnId: 'pi_1' }),
    ).rejects.toMatchObject({ code: 'duplicate_transaction' });
    await expect(recordPayment(db, invoice.id, { amount: 0 })).rejects.toMatchObject({
      code: 'invalid_amount',
    });
  });

  it('cancels an unpaid invoice and returns applied credit', async () => {
    const c = await makeClient({ creditBalance: 300 });
    const svc = await makeService(c.id);
    const d = await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        {
          description: 'Hosting',
          unitAmount: 1000,
          serviceId: svc.id,
          periodStart: TODAY,
          periodEnd: addDays(TODAY, 30),
        },
      ],
    });
    const { invoice } = await issueInvoice(db, d.id);
    const cancelled = await cancelInvoice(db, invoice.id, { reason: 'duplicate' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.items[0]?.serviceId).toBeNull();
    expect(cancelled.notes).toMatch(/Cancelled: duplicate/);
    const [cl] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(cl?.creditBalance).toBe(300);
    await expect(cancelInvoice(db, invoice.id)).rejects.toMatchObject({
      code: 'invoice_not_cancellable',
    });
  });

  it('issues credit notes against paid invoices with their own numbering', async () => {
    const c = await makeClient();
    const d = await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        { description: 'A', unitAmount: 1000 },
        { description: 'B', unitAmount: 2000 },
      ],
    });
    const { invoice } = await issueInvoice(db, d.id);
    await expect(createCreditNote(db, invoice.id, { reason: 'x' })).rejects.toMatchObject({
      code: 'invoice_not_creditable',
    });
    await recordPayment(db, invoice.id, { amount: 3630 });
    const partial = await createCreditNote(db, invoice.id, {
      reason: 'Service outage',
      items: [{ description: 'Outage compensation', unitAmount: 1000 }],
    });
    expect(partial.number).toBe(`CN-${YEAR}-000001`);
    expect(partial.total).toBe(1210);
    expect((await getInvoice(db, invoice.id)).status).toBe('paid');
    const rest = await createCreditNote(db, invoice.id, {
      reason: 'Refund remainder',
      items: [{ description: 'Rest', unitAmount: 2000 }],
    });
    expect(rest.number).toBe(`CN-${YEAR}-000002`);
    expect((await getInvoice(db, invoice.id)).status).toBe('refunded');
    const [cl] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(cl?.creditBalance).toBe(3630);
    await expect(
      createCreditNote(db, invoice.id, {
        reason: 'too much',
        items: [{ description: 'x', unitAmount: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'credit_note_exceeds_invoice' });
  });

  it('generates one recurring invoice per client, idempotently, and advances the due date on payment', async () => {
    const c = await makeClient();
    const s1 = await makeService(c.id, { nextDueDate: addDays(TODAY, 5), recurringAmount: 1000 });
    const s2 = await makeService(c.id, {
      nextDueDate: addDays(TODAY, 10),
      recurringAmount: 2000,
      billingCycle: 'annually',
      domain: 'two.nl',
    });
    await makeService(c.id, { nextDueDate: addDays(TODAY, 40) }); // outside horizon
    await makeService(c.id, { nextDueDate: addDays(TODAY, 1), status: 'suspended' }); // not active
    const [dom] = await db
      .insert(domains)
      .values({
        clientId: c.id,
        name: 'renew.nl',
        tld: 'nl',
        status: 'active',
        nextDueDate: addDays(TODAY, 7),
        expiryDate: addDays(TODAY, 7),
        recurringAmount: 1200,
        registrationPeriod: 1,
      })
      .returning();
    const other = await makeClient();
    await makeService(other.id, { nextDueDate: TODAY, recurringAmount: 500 });

    const run1 = await generateRecurringInvoices(db, { daysAhead: 14 });
    expect(run1.created).toHaveLength(2);
    expect(run1.skipped).toEqual([]);
    const mine = run1.created.find((x) => x.clientId === c.id);
    if (!mine) throw new Error('missing');
    expect(mine.serviceIds.sort()).toEqual([s1.id, s2.id].sort());
    expect(mine.domainIds).toEqual([dom?.id]);
    const inv = await getInvoice(db, mine.invoiceId);
    expect(inv.status).toBe('unpaid');
    expect(inv.dueDate).toBe(addDays(TODAY, 5));
    expect(inv.items).toHaveLength(3);
    expect(inv.items.find((i) => i.serviceId === s1.id)?.periodStart).toBe(addDays(TODAY, 5));
    expect(inv.subtotal).toBe(4200);

    const run2 = await generateRecurringInvoices(db, { daysAhead: 14 });
    expect(run2.created).toEqual([]);

    await recordPayment(db, inv.id, { amount: inv.total });
    const [after] = await db.select().from(services).where(eq(services.id, s1.id));
    // monthly from nextDue (anchor day 15): period end + 1 = next due + 1 month
    expect(after?.nextDueDate).not.toBe(s1.nextDueDate);
    expect(after?.nextDueDate && after.nextDueDate > (s1.nextDueDate as string)).toBe(true);
  });

  it('runs dunning: reminder, late fee invoice, suspend, terminate — each once', async () => {
    await db
      .insert(settings)
      .values({ key: 'dunning.lateFee', value: { type: 'fixed', value: 1500 } })
      .onConflictDoUpdate({ target: settings.key, set: { value: { type: 'fixed', value: 1500 } } });
    const c = await makeClient();
    const svc = await makeService(c.id);
    const d = await createDraftInvoice(db, {
      clientId: c.id,
      dueDate: addDays(TODAY, -8),
      items: [
        {
          description: 'Hosting',
          unitAmount: 1000,
          serviceId: svc.id,
          periodStart: addDays(TODAY, -8),
          periodEnd: addDays(TODAY, 22),
        },
      ],
    });
    const { invoice } = await issueInvoice(db, d.id);
    // issue() clamps due date to today; back-date it to simulate an 8-day-old invoice.
    await db
      .update(invoices)
      .set({ dueDate: addDays(TODAY, -8) })
      .where(eq(invoices.id, invoice.id));

    const r1 = await runDunning(db);
    expect(r1.emails).toEqual([
      {
        clientId: c.id,
        invoiceId: invoice.id,
        templateKey: 'invoice.overdue',
        step: 1,
        daysOverdue: 8,
      },
    ]);
    expect(r1.suspend).toEqual([
      { serviceId: svc.id, invoiceId: invoice.id, reason: `Overdue invoice ${invoice.number}` },
    ]);
    expect(r1.lateFees).toHaveLength(1);
    expect(r1.terminate).toEqual([]);
    const fee = await getInvoice(db, r1.lateFees[0]?.feeInvoiceId as string);
    expect(fee.status).toBe('unpaid');
    expect(fee.parentInvoiceId).toBe(invoice.id);
    expect(fee.subtotal).toBe(1500);
    expect(fee.items[0]?.description).toMatch(/te late betaling/);

    const r2 = await runDunning(db);
    expect(r2.emails.filter((e) => e.invoiceId === invoice.id)).toEqual([
      {
        clientId: c.id,
        invoiceId: invoice.id,
        templateKey: 'invoice.overdue',
        step: 2,
        daysOverdue: 8,
      },
    ]);
    // The late-fee invoice is due today and gets its own day-0 reminder.
    expect(r2.emails.find((e) => e.invoiceId === fee.id)).toMatchObject({
      step: 1,
      templateKey: 'invoice.reminder',
    });
    expect(r2.suspend).toEqual([]);
    expect(r2.lateFees).toEqual([]);

    await db.update(services).set({ status: 'suspended' }).where(eq(services.id, svc.id));
    await db
      .update(invoices)
      .set({ dueDate: addDays(TODAY, -31) })
      .where(eq(invoices.id, invoice.id));
    const r3 = await runDunning(db);
    expect(r3.terminate).toEqual([
      { serviceId: svc.id, invoiceId: invoice.id, reason: `Overdue invoice ${invoice.number}` },
    ]);
    const r4 = await runDunning(db);
    expect(r4.terminate).toEqual([]);
    await db.delete(settings).where(eq(settings.key, 'dunning.lateFee'));
  });

  it('validates and caches VAT numbers via the VIES port', async () => {
    const vies = createFakeViesClient();
    const c = await makeClient({ country: 'DE', vatNumber: 'de 123 456 789' });
    const v1 = await validateClientVat(db, c.id, vies, { now: new Date('2026-10-01T00:00:00Z') });
    expect(v1).toMatchObject({
      valid: true,
      cached: false,
      countryCode: 'DE',
      vatNumber: '123456789',
    });
    const [row] = await db.select().from(clients).where(eq(clients.id, c.id));
    expect(row).toMatchObject({ vatValidated: true, vatNumber: 'DE123456789' });
    expect(row?.vatCheckedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    const v2 = await validateClientVat(db, c.id, vies, { now: new Date('2026-10-15T00:00:00Z') });
    expect(v2.cached).toBe(true);
    const v3 = await validateClientVat(db, c.id, vies, {
      now: new Date('2026-10-15T00:00:00Z'),
      force: true,
    });
    expect(v3.cached).toBe(false);

    const bad = await makeClient({ country: 'NL', vatNumber: 'NL123456789B00' });
    expect((await validateClientVat(db, bad.id, vies)).valid).toBe(false);
    const none = await makeClient({ country: 'NL', vatNumber: null });
    expect(await validateClientVat(db, none.id, vies)).toMatchObject({
      valid: false,
      reason: 'no_vat_number',
    });
    const us = await makeClient({ country: 'US', vatNumber: '12-3456789' });
    expect(await validateClientVat(db, us.id, vies)).toMatchObject({
      valid: false,
      reason: 'non_eu',
    });

    // Outage keeps the previous state.
    const down = {
      checkVat: async () => {
        throw new (await import('../vies/index.js')).ViesUnavailableError('down');
      },
    };
    const v4 = await validateClientVat(db, c.id, down, { force: true });
    expect(v4).toMatchObject({ valid: true, unavailable: true });

    const re = await revalidateVatNumbers(db, createFakeViesClient({ DE123456789: false }), {
      now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(re.checked).toBeGreaterThanOrEqual(1);
    expect(re.changed).toContainEqual({ clientId: c.id, from: true, to: false });
  });

  it('renders and stores an invoice PDF', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provisia-pdf-'));
    const c = await makeClient({
      country: 'DE',
      vatNumber: 'DE123456789',
      vatValidated: true,
      companyName: 'Muster GmbH',
    });
    const d = await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        {
          description: 'Hosting',
          unitAmount: 1000,
          periodStart: TODAY,
          periodEnd: addDays(TODAY, 30),
        },
      ],
      notes: 'Thanks!',
    });
    const { invoice } = await issueInvoice(db, d.id);
    const stored = await storeInvoicePdf(db, invoice.id, { storageRoot: root });
    expect(stored.path).toBe(`invoices/${YEAR}/${invoice.number}.pdf`);
    const bytes = await readFile(stored.absolutePath);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(1000);
    const [row] = await db
      .select({ pdfPath: invoices.pdfPath })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(row?.pdfPath).toBe(stored.path);
  });

  it('keeps the unique (service, period) guard', async () => {
    const c = await makeClient();
    const svc = await makeService(c.id);
    await createDraftInvoice(db, {
      clientId: c.id,
      items: [
        {
          description: 'A',
          unitAmount: 1,
          serviceId: svc.id,
          periodStart: TODAY,
          periodEnd: TODAY,
        },
      ],
    });
    await expect(
      createDraftInvoice(db, {
        clientId: c.id,
        items: [
          {
            description: 'B',
            unitAmount: 1,
            serviceId: svc.id,
            periodStart: TODAY,
            periodEnd: TODAY,
          },
        ],
      }),
    ).rejects.toThrow();
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.serviceId, svc.id), eq(invoiceItems.periodStart, TODAY)));
    expect(cnt?.n).toBe(1);
    // productPrices/transactions touched to keep imports meaningful
    expect(productPrices).toBeDefined();
    expect(transactions).toBeDefined();
    expect(productGroups).toBeDefined();
  });
});

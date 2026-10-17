import { invoiceItems, invoices, services } from '@provisia/db';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { toIsoDate } from '../dates.js';
import {
  type DunningAction,
  type DunningSettings,
  dunningSettingsFrom,
  evaluateDunning,
} from '../dunning.js';
import { createLateFeeInvoice, openAmount } from './invoices.js';
import { loadSettings } from './settings.js';
import type { Executor } from './types.js';

export interface DunningEffects {
  emails: Array<{
    clientId: string;
    invoiceId: string;
    templateKey: 'invoice.reminder' | 'invoice.overdue';
    step: number;
    daysOverdue: number;
  }>;
  suspend: Array<{ serviceId: string; invoiceId: string; reason: string }>;
  terminate: Array<{ serviceId: string; invoiceId: string; reason: string }>;
  lateFees: Array<{ invoiceId: string; feeInvoiceId: string; amount: number }>;
  evaluated: number;
}

export interface DunningRunOptions {
  now?: Date;
  settings?: DunningSettings;
  /** Dry run: evaluate and return effects without writing anything. */
  dryRun?: boolean;
}

/**
 * Evaluates every open invoice past its due date against the dunning schedule, persists the step markers
 * and returns the side effects for the worker to enqueue (emails, suspend/terminate jobs). The run itself
 * does not send mail or call modules, so it is safe to re-run: markers make each step fire once.
 */
export async function runDunning(
  db: Executor,
  opts: DunningRunOptions = {},
): Promise<DunningEffects> {
  const now = opts.now ?? new Date();
  const today = toIsoDate(now);
  const settings = opts.settings ?? dunningSettingsFrom(await loadSettings(db));
  const effects: DunningEffects = {
    emails: [],
    suspend: [],
    terminate: [],
    lateFees: [],
    evaluated: 0,
  };

  const due = await db
    .select()
    .from(invoices)
    .where(
      and(
        inArray(invoices.status, ['unpaid', 'collections']),
        isNotNull(invoices.dueDate),
        lte(invoices.dueDate, today),
      ),
    );

  for (const inv of due) {
    effects.evaluated += 1;
    const open = await openAmount(db, inv);
    const linked = await db
      .select({ id: services.id, status: services.status })
      .from(invoiceItems)
      .innerJoin(services, eq(services.id, invoiceItems.serviceId))
      .where(eq(invoiceItems.invoiceId, inv.id));
    const unique = new Map(linked.map((s) => [s.id, s.status]));
    const actions = evaluateDunning(
      settings,
      {
        status: inv.status === 'collections' ? 'unpaid' : inv.status,
        dueDate: inv.dueDate,
        openAmount: open,
        reminderCount: inv.reminderCount,
        lateFeeAppliedAt: inv.lateFeeAppliedAt,
        dunningSuspendedAt: inv.dunningSuspendedAt,
        dunningTerminatedAt: inv.dunningTerminatedAt,
        suspendableServiceIds: [...unique].filter(([, st]) => st === 'active').map(([id]) => id),
        terminableServiceIds: [...unique]
          .filter(([, st]) => st === 'active' || st === 'suspended')
          .map(([id]) => id),
      },
      now,
    );
    if (actions.length === 0) continue;
    if (opts.dryRun) {
      collect(effects, inv, actions);
      continue;
    }
    await db.transaction(async (tx) => {
      for (const a of actions) {
        switch (a.type) {
          case 'remind':
            await tx
              .update(invoices)
              .set({ reminderCount: a.step, lastReminderAt: now })
              .where(eq(invoices.id, inv.id));
            effects.emails.push({
              clientId: inv.clientId,
              invoiceId: inv.id,
              templateKey: a.templateKey,
              step: a.step,
              daysOverdue: a.daysOverdue,
            });
            break;
          case 'late_fee': {
            const fee = await createLateFeeInvoice(tx, inv.id, a.amount, { now });
            effects.lateFees.push({ invoiceId: inv.id, feeInvoiceId: fee.id, amount: a.amount });
            break;
          }
          case 'suspend':
            await tx
              .update(invoices)
              .set({ dunningSuspendedAt: now })
              .where(eq(invoices.id, inv.id));
            for (const serviceId of a.serviceIds) {
              effects.suspend.push({
                serviceId,
                invoiceId: inv.id,
                reason: `Overdue invoice ${inv.number ?? inv.id}`,
              });
            }
            break;
          case 'terminate':
            await tx
              .update(invoices)
              .set({ dunningTerminatedAt: now })
              .where(eq(invoices.id, inv.id));
            for (const serviceId of a.serviceIds) {
              effects.terminate.push({
                serviceId,
                invoiceId: inv.id,
                reason: `Overdue invoice ${inv.number ?? inv.id}`,
              });
            }
            break;
        }
      }
    });
  }
  return effects;
}

function collect(
  effects: DunningEffects,
  inv: { id: string; clientId: string; number: string | null },
  actions: DunningAction[],
) {
  for (const a of actions) {
    if (a.type === 'remind')
      effects.emails.push({
        clientId: inv.clientId,
        invoiceId: inv.id,
        templateKey: a.templateKey,
        step: a.step,
        daysOverdue: a.daysOverdue,
      });
    if (a.type === 'late_fee')
      effects.lateFees.push({ invoiceId: inv.id, feeInvoiceId: '', amount: a.amount });
    if (a.type === 'suspend')
      for (const serviceId of a.serviceIds)
        effects.suspend.push({ serviceId, invoiceId: inv.id, reason: 'dry-run' });
    if (a.type === 'terminate')
      for (const serviceId of a.serviceIds)
        effects.terminate.push({ serviceId, invoiceId: inv.id, reason: 'dry-run' });
  }
}

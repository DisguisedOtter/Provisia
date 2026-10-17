import type { IsoDate } from './dates.js';
import { daysBetween, toIsoDate } from './dates.js';
import { percentOf } from './money.js';

export interface LateFeeSetting {
  type: 'none' | 'fixed' | 'percentage';
  /** Minor units for `fixed`, percent for `percentage`. */
  value: number;
}

export interface DunningSettings {
  /** Days after the due date at which reminders go out; `0` = on the due date. Sorted ascending. */
  reminderDays: number[];
  /** `0` disables. */
  suspendAfterDays: number;
  /** `0` disables. */
  terminateAfterDays: number;
  lateFee: LateFeeSetting;
  lateFeeAfterDays: number;
}

export interface DunningInvoiceState {
  status: string;
  dueDate: IsoDate | null;
  /** Amount still open (total - credit - payments). Zero-balance invoices get no dunning. */
  openAmount: number;
  reminderCount: number;
  lateFeeAppliedAt: Date | null;
  dunningSuspendedAt: Date | null;
  dunningTerminatedAt: Date | null;
  /** Services linked to the invoice lines that can still be suspended (status active). */
  suspendableServiceIds: string[];
  /** Services linked that can be terminated (status active or suspended). */
  terminableServiceIds: string[];
}

export type DunningAction =
  | {
      type: 'remind';
      /** 1-based reminder step. */
      step: number;
      /** `invoice.reminder` for step 1 at/before due, `invoice.overdue` afterwards. */
      templateKey: 'invoice.reminder' | 'invoice.overdue';
      daysOverdue: number;
    }
  | { type: 'late_fee'; amount: number; daysOverdue: number }
  | { type: 'suspend'; serviceIds: string[]; daysOverdue: number }
  | { type: 'terminate'; serviceIds: string[]; daysOverdue: number };

export function lateFeeAmount(setting: LateFeeSetting, openAmount: number): number {
  if (setting.type === 'fixed') return Math.max(0, Math.round(setting.value));
  if (setting.type === 'percentage') return Math.max(0, percentOf(openAmount, setting.value));
  return 0;
}

/** Whole days past due (negative before the due date). Date-based, UTC. */
export function daysOverdue(dueDate: IsoDate, now: Date | IsoDate): number {
  const today = typeof now === 'string' ? now : toIsoDate(now);
  return daysBetween(dueDate, today);
}

/**
 * Pure evaluation of one unpaid invoice against the dunning schedule. Returns every action that is
 * due *now* and has not been performed yet (markers in the state). At most one reminder per run:
 * the next pending step, even if several thresholds were passed (e.g. after downtime) — the caller
 * runs daily, so missed steps catch up one per day instead of spamming.
 */
export function evaluateDunning(
  settings: DunningSettings,
  state: DunningInvoiceState,
  now: Date | IsoDate,
): DunningAction[] {
  const actions: DunningAction[] = [];
  if (state.status !== 'unpaid' || !state.dueDate || state.openAmount <= 0) return actions;
  const overdue = daysOverdue(state.dueDate, now);

  const steps = [...settings.reminderDays].sort((a, b) => a - b);
  const nextStep = state.reminderCount; // index of the next reminder
  const threshold = steps[nextStep];
  if (threshold !== undefined && overdue >= threshold) {
    actions.push({
      type: 'remind',
      step: nextStep + 1,
      templateKey: overdue <= 0 ? 'invoice.reminder' : 'invoice.overdue',
      daysOverdue: overdue,
    });
  }

  if (
    settings.lateFee.type !== 'none' &&
    !state.lateFeeAppliedAt &&
    overdue >= settings.lateFeeAfterDays &&
    overdue > 0
  ) {
    const amount = lateFeeAmount(settings.lateFee, state.openAmount);
    if (amount > 0) actions.push({ type: 'late_fee', amount, daysOverdue: overdue });
  }

  if (
    settings.suspendAfterDays > 0 &&
    !state.dunningSuspendedAt &&
    overdue >= settings.suspendAfterDays &&
    state.suspendableServiceIds.length > 0
  ) {
    actions.push({
      type: 'suspend',
      serviceIds: state.suspendableServiceIds,
      daysOverdue: overdue,
    });
  }

  if (
    settings.terminateAfterDays > 0 &&
    !state.dunningTerminatedAt &&
    overdue >= settings.terminateAfterDays &&
    state.terminableServiceIds.length > 0
  ) {
    actions.push({
      type: 'terminate',
      serviceIds: state.terminableServiceIds,
      daysOverdue: overdue,
    });
  }
  return actions;
}

/** Maps the typed settings object (`@provisia/shared` settingsSchema) to the engine's settings. */
export function dunningSettingsFrom(s: {
  'dunning.reminderDays': number[];
  'dunning.suspendAfterDays': number;
  'dunning.terminateAfterDays': number;
  'dunning.lateFee': LateFeeSetting;
  'dunning.lateFeeAfterDays': number;
}): DunningSettings {
  return {
    reminderDays: s['dunning.reminderDays'],
    suspendAfterDays: s['dunning.suspendAfterDays'],
    terminateAfterDays: s['dunning.terminateAfterDays'],
    lateFee: s['dunning.lateFee'],
    lateFeeAfterDays: s['dunning.lateFeeAfterDays'],
  };
}

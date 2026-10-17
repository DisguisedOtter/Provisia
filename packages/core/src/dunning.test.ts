import { describe, expect, it } from 'vitest';
import {
  type DunningInvoiceState,
  type DunningSettings,
  daysOverdue,
  evaluateDunning,
  lateFeeAmount,
} from './dunning.js';

const settings: DunningSettings = {
  reminderDays: [0, 3, 7],
  suspendAfterDays: 7,
  terminateAfterDays: 30,
  lateFee: { type: 'none', value: 0 },
  lateFeeAfterDays: 7,
};

const state = (over: Partial<DunningInvoiceState> = {}): DunningInvoiceState => ({
  status: 'unpaid',
  dueDate: '2026-03-01',
  openAmount: 10000,
  reminderCount: 0,
  lateFeeAppliedAt: null,
  dunningSuspendedAt: null,
  dunningTerminatedAt: null,
  suspendableServiceIds: ['svc-1'],
  terminableServiceIds: ['svc-1'],
  ...over,
});

describe('dunning', () => {
  it('does nothing before the due date or for non-unpaid / zero-balance invoices', () => {
    expect(evaluateDunning(settings, state(), '2026-02-28')).toEqual([]);
    expect(evaluateDunning(settings, state({ status: 'paid' }), '2026-04-01')).toEqual([]);
    expect(evaluateDunning(settings, state({ status: 'draft' }), '2026-04-01')).toEqual([]);
    expect(evaluateDunning(settings, state({ openAmount: 0 }), '2026-04-01')).toEqual([]);
    expect(evaluateDunning(settings, state({ dueDate: null }), '2026-04-01')).toEqual([]);
  });
  it('sends the due-date reminder on day 0 with the reminder template', () => {
    expect(evaluateDunning(settings, state(), '2026-03-01')).toEqual([
      { type: 'remind', step: 1, templateKey: 'invoice.reminder', daysOverdue: 0 },
    ]);
  });
  it('sends the next pending reminder only once', () => {
    expect(evaluateDunning(settings, state({ reminderCount: 1 }), '2026-03-02')).toEqual([]);
    expect(evaluateDunning(settings, state({ reminderCount: 1 }), '2026-03-04')).toEqual([
      { type: 'remind', step: 2, templateKey: 'invoice.overdue', daysOverdue: 3 },
    ]);
    expect(
      evaluateDunning(
        settings,
        state({ reminderCount: 3, dunningSuspendedAt: new Date() }),
        '2026-03-20',
      ),
    ).toEqual([]);
  });
  it('catches up one step per run after downtime', () => {
    const a = evaluateDunning(settings, state({ reminderCount: 0 }), '2026-03-05');
    expect(a.filter((x) => x.type === 'remind')).toEqual([
      { type: 'remind', step: 1, templateKey: 'invoice.overdue', daysOverdue: 4 },
    ]);
  });
  it('suspends at +7 and terminates at +30, each once', () => {
    const day7 = evaluateDunning(settings, state({ reminderCount: 2 }), '2026-03-08');
    expect(day7).toEqual([
      { type: 'remind', step: 3, templateKey: 'invoice.overdue', daysOverdue: 7 },
      { type: 'suspend', serviceIds: ['svc-1'], daysOverdue: 7 },
    ]);
    const already = evaluateDunning(
      settings,
      state({ reminderCount: 3, dunningSuspendedAt: new Date() }),
      '2026-03-10',
    );
    expect(already).toEqual([]);
    const day30 = evaluateDunning(
      settings,
      state({ reminderCount: 3, dunningSuspendedAt: new Date() }),
      '2026-03-31',
    );
    expect(day30).toEqual([{ type: 'terminate', serviceIds: ['svc-1'], daysOverdue: 30 }]);
    expect(
      evaluateDunning(
        settings,
        state({
          reminderCount: 3,
          dunningSuspendedAt: new Date(),
          dunningTerminatedAt: new Date(),
        }),
        '2026-05-01',
      ),
    ).toEqual([]);
  });
  it('skips suspend/terminate when nothing can be suspended or when disabled (0)', () => {
    expect(
      evaluateDunning(
        settings,
        state({ reminderCount: 3, suspendableServiceIds: [], terminableServiceIds: [] }),
        '2026-04-15',
      ),
    ).toEqual([]);
    const disabled = { ...settings, suspendAfterDays: 0, terminateAfterDays: 0 };
    expect(evaluateDunning(disabled, state({ reminderCount: 3 }), '2026-06-01')).toEqual([]);
  });
  it('applies a fixed or percentage late fee once, only after the due date', () => {
    const fixed = {
      ...settings,
      lateFee: { type: 'fixed' as const, value: 1500 },
      lateFeeAfterDays: 0,
    };
    expect(evaluateDunning(fixed, state({ reminderCount: 1 }), '2026-03-01')).toEqual([]);
    expect(evaluateDunning(fixed, state({ reminderCount: 1 }), '2026-03-02')).toEqual([
      { type: 'late_fee', amount: 1500, daysOverdue: 1 },
    ]);
    expect(
      evaluateDunning(
        fixed,
        state({ reminderCount: 1, lateFeeAppliedAt: new Date() }),
        '2026-03-02',
      ),
    ).toEqual([]);
    const pct = { ...settings, lateFee: { type: 'percentage' as const, value: 2.5 } };
    const actions = evaluateDunning(
      pct,
      state({ reminderCount: 3, dunningSuspendedAt: new Date() }),
      '2026-03-08',
    );
    expect(actions).toEqual([{ type: 'late_fee', amount: 250, daysOverdue: 7 }]);
    expect(lateFeeAmount({ type: 'percentage', value: 2.5 }, 10001)).toBe(250);
    expect(lateFeeAmount({ type: 'none', value: 100 }, 10000)).toBe(0);
  });
  it('computes days overdue from a Date in UTC', () => {
    expect(daysOverdue('2026-03-01', new Date('2026-03-04T23:59:59Z'))).toBe(3);
    expect(daysOverdue('2026-03-01', new Date('2026-02-27T00:00:00Z'))).toBe(-2);
  });
  it('supports custom reminder schedules (unsorted input)', () => {
    const custom = { ...settings, reminderDays: [14, 1, 5] };
    expect(evaluateDunning(custom, state(), '2026-03-01')).toEqual([]);
    expect(evaluateDunning(custom, state(), '2026-03-02')[0]).toMatchObject({
      type: 'remind',
      step: 1,
    });
    expect(
      evaluateDunning(
        custom,
        state({ reminderCount: 2, dunningSuspendedAt: new Date() }),
        '2026-03-10',
      ),
    ).toEqual([]);
    expect(
      evaluateDunning(
        custom,
        state({ reminderCount: 2, dunningSuspendedAt: new Date() }),
        '2026-03-15',
      )[0],
    ).toMatchObject({ step: 3 });
  });
});

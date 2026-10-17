import { type BillingCycle, formatMoney, type Money } from '@provisia/shared';
import type { Locale } from './i18n';

const INTL_LOCALE: Record<Locale, string> = { en: 'en-IE', nl: 'nl-NL' };

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

/** Integer minor units + currency → "€ 12,34" / "€12.34" depending on locale. */
export function fmtMoney(amount: number, currency = 'EUR', locale: Locale = 'en'): string {
  return formatMoney({ amount, currency } satisfies Money, intlLocale(locale));
}

export function fmtDate(value: string | Date | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '—';
  const d =
    typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' }).format(d);
}

export function fmtDateTime(
  value: string | Date | null | undefined,
  locale: Locale = 'en',
): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function fmtRelativeDays(value: string | null | undefined, locale: Locale = 'en'): string {
  const days = daysUntil(value);
  if (days === null) return '—';
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  return rtf.format(days, 'day');
}

/** Whole days from today until an ISO date (negative when in the past). */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export const BILLING_CYCLES: BillingCycle[] = [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
  'onetime',
];

export function fmtBytesFromMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return '—';
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function fmtPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

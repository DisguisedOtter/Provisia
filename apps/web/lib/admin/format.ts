import { BILLING_CYCLE_MONTHS, type BillingCycle, formatMoney } from '@provisia/shared';

export type Locale = 'nl-NL' | 'en-GB';

let currentLocale: Locale = 'nl-NL';
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}
export function setLocale(locale: Locale) {
  currentLocale = locale;
  try {
    window.localStorage.setItem('pv_admin_locale', locale);
  } catch {}
  for (const l of listeners) l();
}
export function subscribeLocale(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function loadStoredLocale() {
  try {
    const v = window.localStorage.getItem('pv_admin_locale');
    if (v === 'nl-NL' || v === 'en-GB') currentLocale = v;
  } catch {}
}

/** Minor units + currency → `€ 12,34` (nl-NL) or `€12.34` (en-GB). */
export function fmtMoney(amount: number, currency = 'EUR', locale: Locale = currentLocale) {
  return formatMoney({ amount, currency }, locale);
}

export function fmtDate(value: string | Date | null | undefined, locale: Locale = currentLocale) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function fmtDateTime(
  value: string | Date | null | undefined,
  locale: Locale = currentLocale,
) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function fmtRelative(
  value: string | Date | null | undefined,
  locale: Locale = currentLocale,
) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(d, locale);
}

export function fmtNumber(n: number, locale: Locale = currentLocale) {
  return new Intl.NumberFormat(locale).format(n);
}

export function fmtBytesMb(mb: number | undefined) {
  if (mb === undefined || mb === null) return '—';
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(2)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb} MB`;
}

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannually: 'Semi-annually',
  annually: 'Annually',
  biennially: 'Biennially',
  triennially: 'Triennially',
  onetime: 'One-time',
};
export const BILLING_CYCLES = Object.keys(BILLING_CYCLE_MONTHS) as BillingCycle[];

/** Today's date as `YYYY-MM-DD` (local). */
export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function clientDisplayName(c: {
  companyName?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  user?: { firstName: string; lastName: string; email: string };
  id?: string;
}) {
  const first = c.firstName ?? c.user?.firstName ?? '';
  const last = c.lastName ?? c.user?.lastName ?? '';
  const person = `${first} ${last}`.trim();
  if (c.companyName) return person ? `${c.companyName} (${person})` : c.companyName;
  return person || c.email || c.user?.email || (c.id ? `Client ${c.id.slice(0, 8)}` : 'Client');
}

export function shortId(id: string | null | undefined) {
  return id ? id.slice(0, 8) : '—';
}

export function titleCase(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

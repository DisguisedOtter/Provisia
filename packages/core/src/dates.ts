/**
 * Calendar-date helpers on ISO `YYYY-MM-DD` strings. All arithmetic is done in UTC on whole days so
 * billing never depends on the server time zone. No Date objects leak out of this module.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(value);
  if (!m) throw new TypeError(`invalid ISO date: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`invalid ISO date: ${value}`);
  }
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days since 1970-01-01 (UTC). */
export function toDayNumber(value: IsoDate): number {
  const { year, month, day } = parseIsoDate(value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromDayNumber(days: number): IsoDate {
  const d = new Date(days * 86_400_000);
  return formatIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(value) + days);
}

/** `b - a` in whole days; positive when `b` is later. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/**
 * Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 → Feb 28/29).
 * Pass `anchorDay` to restore the original day-of-month when the target month allows it, so a
 * subscription anchored on the 31st goes 31 Jan → 28 Feb → 31 Mar instead of drifting to the 28th.
 */
export function addMonths(value: IsoDate, months: number, anchorDay?: number): IsoDate {
  const { year, month, day } = parseIsoDate(value);
  const total = year * 12 + (month - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const wanted = anchorDay ?? day;
  return formatIsoDate(ty, tm, Math.min(wanted, daysInMonth(ty, tm)));
}

export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** `YYYY-MM-DD` of a Date in UTC. */
export function toIsoDate(date: Date): IsoDate {
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function yearOf(value: IsoDate): number {
  return parseIsoDate(value).year;
}

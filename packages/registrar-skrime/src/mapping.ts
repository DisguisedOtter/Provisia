import type { DomainInfo, TldPrice } from '@provisia/module-sdk';
import type { DomainContact, DomainContacts } from '@provisia/shared';

/** Skrime's contact object as sent to `domain/order` / `domain/contact`. */
export interface SkrimeContact {
  company: string;
  firstname: string;
  lastname: string;
  street: string;
  number: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
  email: string;
  phone: string;
}

/** Ported from `extractStreetAndNumber()`: splits "Hauptstraße 12a" into ["Hauptstraße", "12a"]. */
export function splitStreetAndNumber(address: string): [string, string] {
  const m = /^(.+?)\s?(\d+.*)$/.exec(address.trim());
  if (m?.[1] !== undefined && m[2] !== undefined) return [m[1].trim(), m[2].trim()];
  return [address.trim(), ''];
}

/**
 * Ported from `cleanOrganizationName()`. The reference deleted `(`, `)`, `Ä`, `Ö`, `Ü`; we
 * transliterate umlauts instead of dropping them so "Müller GmbH" stays recognisable.
 */
export function cleanOrganizationName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .replace(/[()]/g, '')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();
}

export function toSkrimeContact(c: DomainContact): SkrimeContact {
  const [street, number] = splitStreetAndNumber(c.address1);
  return {
    company: cleanOrganizationName(c.organization),
    firstname: c.firstName,
    lastname: c.lastName,
    street,
    number: number || (c.address2 ?? ''),
    postcode: c.postalCode,
    city: c.city,
    state: c.state ?? '',
    country: c.country.toUpperCase(),
    email: c.email,
    phone: c.phone,
  };
}

/** Skrime has one owner contact per domain; `domain/contact` returns it flat. */
export function fromSkrimeContact(raw: Partial<SkrimeContact>): DomainContacts {
  const registrant: DomainContact = {
    firstName: raw.firstname ?? '',
    lastName: raw.lastname ?? '',
    email: raw.email ?? '',
    phone: raw.phone ?? '',
    address1: [raw.street, raw.number].filter(Boolean).join(' '),
    city: raw.city ?? '',
    postalCode: raw.postcode ?? '',
    country: (raw.country ?? '').toUpperCase(),
  };
  if (raw.company) registrant.organization = raw.company;
  if (raw.state) registrant.state = raw.state;
  return { registrant };
}

/** `2027-03-01T00:00:00.000000Z` / `2027-03-01 00:00:00` / `2027-03-01` -> `2027-03-01`. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (direct?.[1]) return direct[1];
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Shape of `domain/single` as far as the reference module and docs reveal it. */
export interface SkrimeDomainSingle {
  domain?: string;
  expireAt?: string;
  createdAt?: string;
  status?: string;
  state?: string;
  nameserver?: string[];
  autoRenew?: boolean;
  whoisPrivacy?: boolean;
  privacy?: boolean;
  locked?: boolean;
  [key: string]: unknown;
}

export function mapDomainStatus(raw: SkrimeDomainSingle, today = new Date()): DomainInfo['status'] {
  const s = String(raw.status ?? raw.state ?? '').toLowerCase();
  if (s) {
    if (['active', 'ok', 'registered', 'success'].includes(s)) return 'active';
    if (s.includes('expire')) return 'expired';
    if (s.includes('transfer')) return 'pending_transfer';
    if (['pending', 'processing', 'ordered', 'in_progress', 'queued'].includes(s)) return 'pending';
    if (['cancelled', 'canceled', 'deleted', 'terminated'].includes(s)) return 'transferred_away';
  }
  const expiry = toIsoDate(raw.expireAt);
  if (!expiry) return raw.status ? 'unknown' : 'pending';
  return expiry < today.toISOString().slice(0, 10) ? 'expired' : 'active';
}

export interface SkrimePriceRow {
  tld: string;
  create?: number | string;
  renew?: number | string;
  transfer?: number | string;
  restore?: number | string;
  currency?: string;
  [key: string]: unknown;
}

/** Euros as float/string ("9.90") -> integer cents. */
export function eurosToCents(v: number | string | undefined | null): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function normalizeTld(tld: string): string {
  return tld.trim().toLowerCase().replace(/^\.+/, '');
}

export function mapPriceRow(row: SkrimePriceRow): TldPrice & { restore: number } {
  return {
    tld: normalizeTld(row.tld),
    currency: (row.currency ?? 'EUR').toUpperCase(),
    register: eurosToCents(row.create),
    renew: eurosToCents(row.renew),
    transfer: eurosToCents(row.transfer),
    restore: eurosToCents(row.restore),
    minYears: 1,
    maxYears: 10,
  };
}

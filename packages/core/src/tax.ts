import type { IsoDate } from './dates.js';
import { basisPointsToPercent, normalizePercent, percentToBasisPoints } from './money.js';

/** EU member states, ISO 3166-1 alpha-2. VIES uses `EL` for Greece and `XI` for Northern Ireland. */
export const EU_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
] as const;

const EU_SET = new Set<string>(EU_COUNTRIES);

export function isEuCountry(country: string): boolean {
  const c = country.toUpperCase();
  return EU_SET.has(c === 'EL' ? 'GR' : c);
}

/** A `tax_rules` row as the engine needs it. */
export interface TaxRuleInput {
  country: string;
  eu: boolean;
  /** Percent, `"21.00"` or 21. */
  rate: string | number;
  b2bReverseCharge: boolean;
  /** ISO date from which the rule applies. */
  validFrom: IsoDate;
}

export type TaxKind = 'domestic' | 'eu_b2c' | 'eu_reverse_charge' | 'export' | 'exempt';

export interface TaxNote {
  en: string;
  nl: string;
}

export interface TaxDecision {
  /** Rate applied to taxable lines, as a number (21). */
  ratePercent: number;
  /** Same, canonical DTO string (`"21.00"`). */
  rate: string;
  reverseCharge: boolean;
  kind: TaxKind;
  /** Client country is an EU member (per the matching rule, or the built-in list when no rule). */
  euMember: boolean;
  /** Legal text printed on the invoice when VAT is not charged. */
  note: TaxNote | null;
  /** The rule that was applied, if any. */
  rule: TaxRuleInput | null;
}

export interface TaxContext {
  /** Client's billing country (ISO alpha-2). */
  clientCountry: string;
  /** The merchant's country; domestic sales are always taxed (never reverse-charged). */
  homeCountry: string;
  vatNumber: string | null | undefined;
  /** VIES-validated flag as cached on the client. */
  vatValidated: boolean;
  /** Manual exemption override. */
  taxExempt?: boolean;
  rules: TaxRuleInput[];
  /** Date for which the rule must be valid (invoice issue date). */
  asOf: IsoDate;
}

export const TAX_NOTES: Record<Exclude<TaxKind, 'domestic' | 'eu_b2c'>, TaxNote> = {
  eu_reverse_charge: {
    en: 'VAT reverse charged. Article 196 of Council Directive 2006/112/EC: the recipient is liable to account for the VAT.',
    nl: 'BTW verlegd. Artikel 196 van de BTW-richtlijn 2006/112/EG: de afnemer is de BTW verschuldigd.',
  },
  export: {
    en: 'No VAT charged: supply of services to a customer established outside the European Union (Article 44 of Directive 2006/112/EC).',
    nl: 'Geen BTW berekend: dienst verricht aan een afnemer buiten de Europese Unie (artikel 44 BTW-richtlijn 2006/112/EG, artikel 6 Wet OB).',
  },
  exempt: {
    en: 'VAT exempt.',
    nl: 'Vrijgesteld van BTW.',
  },
};

/** The rule in force for a country on `asOf`: latest `validFrom` that is not in the future. */
export function findTaxRule(
  rules: TaxRuleInput[],
  country: string,
  asOf: IsoDate,
): TaxRuleInput | null {
  const c = country.toUpperCase();
  let best: TaxRuleInput | null = null;
  for (const r of rules) {
    if (r.country.toUpperCase() !== c || r.validFrom > asOf) continue;
    if (!best || r.validFrom > best.validFrom) best = r;
  }
  return best;
}

/**
 * Decides the VAT treatment for one client (EU/NL rules, ARCHITECTURE.md section 5):
 *  - home country → standard rate, never reverse-charged, even with a VAT number;
 *  - other EU country, validated VAT number and rule allows it → 0% reverse charge;
 *  - other EU country otherwise (B2C or unvalidated) → that country's rate;
 *  - non-EU (or no rule and not EU) → 0% export;
 *  - taxExempt override → 0% exempt.
 */
export function resolveTax(ctx: TaxContext): TaxDecision {
  const client = ctx.clientCountry.toUpperCase();
  const home = ctx.homeCountry.toUpperCase();
  const rule = findTaxRule(ctx.rules, client, ctx.asOf);
  const euMember = rule ? rule.eu : isEuCountry(client);
  const zero = (kind: TaxKind): TaxDecision => ({
    ratePercent: 0,
    rate: '0.00',
    reverseCharge: kind === 'eu_reverse_charge',
    kind,
    euMember,
    note: kind === 'domestic' || kind === 'eu_b2c' ? null : TAX_NOTES[kind],
    rule,
  });

  if (ctx.taxExempt) return zero('exempt');
  if (!rule) return zero(euMember ? 'eu_b2c' : 'export');
  if (!rule.eu) return zero('export');

  const bp = percentToBasisPoints(rule.rate);
  const taxed = (kind: TaxKind): TaxDecision => ({
    ratePercent: bp / 100,
    rate: basisPointsToPercent(bp),
    reverseCharge: false,
    kind,
    euMember,
    note: null,
    rule,
  });

  if (client === home) return taxed('domestic');
  const hasVat = !!ctx.vatNumber && ctx.vatNumber.trim().length > 0;
  if (hasVat && ctx.vatValidated && rule.b2bReverseCharge) return zero('eu_reverse_charge');
  return taxed('eu_b2c');
}

/** Rate for a single line: the decision's rate for taxable products, 0 otherwise. */
export function lineTaxRate(decision: TaxDecision, taxable: boolean): string {
  return taxable ? decision.rate : '0.00';
}

/** Legal note in the client's language (falls back to English). */
export function taxNoteFor(decision: TaxDecision, language: string): string | null {
  if (!decision.note) return null;
  return language.toLowerCase().startsWith('nl') ? decision.note.nl : decision.note.en;
}

export { normalizePercent };

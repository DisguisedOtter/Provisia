/** Result of a VIES (EU VAT Information Exchange System) lookup. */
export interface ViesCheckResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  /** VIES consultation number (proof of the check) when the service returns one. */
  requestIdentifier: string | null;
  checkedAt: Date;
}

export class ViesUnavailableError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ViesUnavailableError';
  }
}

/** Port implemented by the REST adapter (and by fakes in tests). */
export interface ViesClient {
  /** Throws `ViesUnavailableError` when the member state / service is down; never for an invalid number. */
  checkVat(countryCode: string, vatNumber: string): Promise<ViesCheckResult>;
}

export interface ParsedVatNumber {
  /** VIES country prefix (`EL` for Greece, `XI` for Northern Ireland). */
  countryCode: string;
  /** Digits/letters after the prefix, no separators. */
  number: string;
  /** Canonical `NL123456789B01` form. */
  normalized: string;
}

const VIES_PREFIXES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'XI',
]);

/** ISO country → VIES prefix (`GR` → `EL`). */
export function viesPrefixFor(isoCountry: string): string {
  const c = isoCountry.toUpperCase();
  return c === 'GR' ? 'EL' : c;
}

/**
 * Normalizes user input (`nl 1234.56789.b01`) into VIES parts. Accepts numbers without a prefix when
 * `defaultCountry` is given. Returns null when the result cannot be an EU VAT number.
 */
export function parseVatNumber(input: string, defaultCountry?: string): ParsedVatNumber | null {
  const cleaned = input.replace(/[\s.\-/]/g, '').toUpperCase();
  if (cleaned.length < 4) return null;
  let countryCode: string;
  let number: string;
  if (VIES_PREFIXES.has(cleaned.slice(0, 2)) && /^[A-Z0-9+*]+$/.test(cleaned.slice(2))) {
    countryCode = cleaned.slice(0, 2);
    number = cleaned.slice(2);
  } else if (defaultCountry) {
    countryCode = viesPrefixFor(defaultCountry);
    if (!VIES_PREFIXES.has(countryCode)) return null;
    number = cleaned;
  } else {
    return null;
  }
  if (number.length < 2 || number.length > 14 || !/^[A-Z0-9+*]+$/.test(number)) return null;
  return { countryCode, number, normalized: `${countryCode}${number}` };
}

/** Dutch VAT id checksum (`NL` + 9 digits + `B` + 2 digits, mod-97 on the alphanumeric form since 2020). */
export function isPlausibleNlVat(number: string): boolean {
  const m = /^(\d{9})B(\d{2})$/.exec(number);
  if (!m) return false;
  const str = `NL${number}`;
  // Convert letters to numbers (A=10 ... Z=35), then mod 97 == 1.
  let digits = '';
  for (const ch of str) {
    digits += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

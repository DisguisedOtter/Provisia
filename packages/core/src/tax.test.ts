import { describe, expect, it } from 'vitest';
import {
  findTaxRule,
  isEuCountry,
  lineTaxRate,
  resolveTax,
  type TaxRuleInput,
  taxNoteFor,
} from './tax.js';

const rules: TaxRuleInput[] = [
  { country: 'NL', eu: true, rate: '21.00', b2bReverseCharge: false, validFrom: '2025-01-01' },
  { country: 'DE', eu: true, rate: '19.00', b2bReverseCharge: true, validFrom: '2025-01-01' },
  { country: 'BE', eu: true, rate: '21.00', b2bReverseCharge: true, validFrom: '2025-01-01' },
  { country: 'EE', eu: true, rate: '22.00', b2bReverseCharge: true, validFrom: '2024-01-01' },
  { country: 'EE', eu: true, rate: '24.00', b2bReverseCharge: true, validFrom: '2025-07-01' },
  { country: 'CH', eu: false, rate: '8.10', b2bReverseCharge: false, validFrom: '2024-01-01' },
];

const base = { homeCountry: 'NL', rules, asOf: '2026-01-15', vatNumber: null, vatValidated: false };

describe('tax engine', () => {
  it('NL domestic is 21%, also with a validated VAT number', () => {
    const d = resolveTax({ ...base, clientCountry: 'NL' });
    expect(d).toMatchObject({
      ratePercent: 21,
      rate: '21.00',
      reverseCharge: false,
      kind: 'domestic',
    });
    const b2b = resolveTax({
      ...base,
      clientCountry: 'NL',
      vatNumber: 'NL123456789B01',
      vatValidated: true,
    });
    expect(b2b.kind).toBe('domestic');
    expect(b2b.ratePercent).toBe(21);
    expect(b2b.note).toBeNull();
  });
  it('EU B2C pays destination-country VAT', () => {
    const d = resolveTax({ ...base, clientCountry: 'DE' });
    expect(d).toMatchObject({
      ratePercent: 19,
      kind: 'eu_b2c',
      reverseCharge: false,
      euMember: true,
    });
  });
  it('EU B2B with validated VAT number is reverse charged with note', () => {
    const d = resolveTax({
      ...base,
      clientCountry: 'DE',
      vatNumber: 'DE123456789',
      vatValidated: true,
    });
    expect(d).toMatchObject({
      ratePercent: 0,
      rate: '0.00',
      reverseCharge: true,
      kind: 'eu_reverse_charge',
    });
    expect(d.note?.en).toMatch(/Article 196/);
    expect(taxNoteFor(d, 'nl-NL')).toMatch(/verlegd/);
    expect(taxNoteFor(d, 'en')).toMatch(/reverse charged/);
  });
  it('EU B2B with an unvalidated VAT number is still taxed', () => {
    const d = resolveTax({
      ...base,
      clientCountry: 'DE',
      vatNumber: 'DE123456789',
      vatValidated: false,
    });
    expect(d.kind).toBe('eu_b2c');
    expect(d.ratePercent).toBe(19);
  });
  it('rule can forbid reverse charge', () => {
    const custom = rules.map((r) => (r.country === 'BE' ? { ...r, b2bReverseCharge: false } : r));
    const d = resolveTax({
      ...base,
      rules: custom,
      clientCountry: 'BE',
      vatNumber: 'BE0123456789',
      vatValidated: true,
    });
    expect(d.kind).toBe('eu_b2c');
  });
  it('non-EU is 0% export, with or without a rule', () => {
    expect(resolveTax({ ...base, clientCountry: 'CH' })).toMatchObject({
      ratePercent: 0,
      kind: 'export',
      euMember: false,
    });
    const us = resolveTax({ ...base, clientCountry: 'US' });
    expect(us.kind).toBe('export');
    expect(us.note?.nl).toMatch(/buiten de Europese Unie/);
    expect(us.rule).toBeNull();
  });
  it('EU country without a rule falls back to 0% but is flagged as EU', () => {
    const d = resolveTax({ ...base, rules: [], clientCountry: 'FR' });
    expect(d).toMatchObject({ ratePercent: 0, kind: 'eu_b2c', euMember: true });
  });
  it('picks the rule valid on the as-of date', () => {
    expect(findTaxRule(rules, 'EE', '2025-06-30')?.rate).toBe('22.00');
    expect(findTaxRule(rules, 'EE', '2025-07-01')?.rate).toBe('24.00');
    expect(findTaxRule(rules, 'ee', '2023-01-01')).toBeNull();
    expect(resolveTax({ ...base, clientCountry: 'EE', asOf: '2025-03-01' }).ratePercent).toBe(22);
  });
  it('manual exemption wins', () => {
    const d = resolveTax({ ...base, clientCountry: 'NL', taxExempt: true });
    expect(d).toMatchObject({ ratePercent: 0, kind: 'exempt', reverseCharge: false });
  });
  it('non-taxable lines get 0% regardless', () => {
    const d = resolveTax({ ...base, clientCountry: 'NL' });
    expect(lineTaxRate(d, true)).toBe('21.00');
    expect(lineTaxRate(d, false)).toBe('0.00');
  });
  it('knows EU membership including Greece prefix', () => {
    expect(isEuCountry('nl')).toBe(true);
    expect(isEuCountry('EL')).toBe(true);
    expect(isEuCountry('GB')).toBe(false);
    expect(isEuCountry('NO')).toBe(false);
  });
});

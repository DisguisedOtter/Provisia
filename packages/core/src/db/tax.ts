import { taxRules } from '@provisia/db';
import type { Settings } from '@provisia/shared';
import type { IsoDate } from '../dates.js';
import { resolveTax, type TaxDecision, type TaxRuleInput } from '../tax.js';
import type { Executor } from './types.js';

export interface TaxableClient {
  country: string;
  vatNumber: string | null;
  vatValidated: boolean;
  taxExempt?: boolean | null;
}

export async function loadTaxRules(db: Executor): Promise<TaxRuleInput[]> {
  const rows = await db
    .select({
      country: taxRules.country,
      eu: taxRules.eu,
      rate: taxRules.rate,
      b2bReverseCharge: taxRules.b2bReverseCharge,
      validFrom: taxRules.validFrom,
    })
    .from(taxRules);
  return rows;
}

/** Tax decision for a client on a date, using the stored tax rules and company settings. */
export async function resolveClientTax(
  db: Executor,
  client: TaxableClient,
  settings: Settings,
  asOf: IsoDate,
  rules?: TaxRuleInput[],
): Promise<TaxDecision> {
  const loaded = rules ?? (await loadTaxRules(db));
  return resolveTax({
    clientCountry: client.country,
    homeCountry: settings['company.country'],
    vatNumber: client.vatNumber,
    vatValidated: client.vatValidated && settings['tax.viesValidation'] !== false,
    taxExempt: client.taxExempt ?? false,
    rules: loaded,
    asOf,
  });
}

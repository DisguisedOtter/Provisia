import { createFakeViesClient, createViesRestClient, type ViesClient } from '@provisia/core';
import type { Db } from '@provisia/db';
import { getSettings } from '../../lib/settings.js';

/**
 * VIES client for the API: the real REST adapter, or the deterministic fake in tests / when
 * `VIES_FAKE=1` (numbers ending in `00` are invalid). The requester id (our own VAT number) is passed
 * when configured so VIES returns a consultation number as proof of the check.
 */
export async function getViesClient(db: Db): Promise<ViesClient> {
  if (process.env.VIES_FAKE === '1' || process.env.NODE_ENV === 'test')
    return createFakeViesClient();
  const company = await getSettings(db, 'company');
  const requester =
    company.vatNumber && company.country
      ? { countryCode: company.country, vatNumber: company.vatNumber.replace(/^[A-Z]{2}/i, '') }
      : undefined;
  return createViesRestClient(requester ? { requester } : {});
}

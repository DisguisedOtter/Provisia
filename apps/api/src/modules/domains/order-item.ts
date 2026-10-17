/**
 * Ordering integration. The orders module (billing agent) calls these two functions; nothing here
 * talks to a registrar. See README.md "Ordering".
 */
import type { Db } from '@provisia/db';
import { tlds } from '@provisia/db';
import {
  type Domain,
  type DomainOrderItem,
  type DomainOrderItemInputRaw,
  domainOrderItemInputSchema,
  splitDomainName,
} from '@provisia/shared';
import { AppError, badRequest } from '../../lib/errors.js';
import { findTldByName, priceForYears, startRegistration, startTransfer } from './service.js';

function cycleForYears(years: number): DomainOrderItem['billingCycle'] {
  if (years === 1) return 'annually';
  if (years === 2) return 'biennially';
  if (years === 3) return 'triennially';
  return 'onetime';
}

/**
 * Validates and prices a domain line for the cart. Throws `AppError` (`tld_not_offered`,
 * `bad_request`, `domain_price_missing`). Pure read: safe to call while building a quote.
 */
export async function createDomainOrderItem(
  db: Db,
  rawInput: DomainOrderItemInputRaw,
  opts: { currency?: string } = {},
): Promise<DomainOrderItem> {
  const input = domainOrderItemInputSchema.parse(rawInput);
  const known = (await db.select({ tld: tlds.tld }).from(tlds)).map((t) => t.tld);
  const { sld, tld } = splitDomainName(input.domain, known);
  if (!sld || !tld) throw badRequest(`"${input.domain}" is not a registrable domain name`);
  const catalog = await findTldByName(db, tld);
  if (!catalog?.enabled) throw new AppError('tld_not_offered', `TLD .${tld} is not offered`, 400);
  if (input.years < catalog.minYears || input.years > catalog.maxYears) {
    throw badRequest(`.${tld} can be ordered for ${catalog.minYears}-${catalog.maxYears} years`);
  }
  if (input.type === 'domain_transfer' && catalog.eppRequired && !input.eppCode) {
    throw badRequest(`.${tld} transfers require an EPP code`);
  }
  if (input.idProtection && !catalog.idProtectionSupported) {
    throw badRequest(`.${tld} does not support ID protection`);
  }
  for (const f of catalog.additionalFields) {
    if (f.required && !input.additionalFields[f.name])
      throw badRequest(`.${tld} requires field "${f.label}"`);
  }
  const currency = opts.currency ?? catalog.currency;
  const kind = input.type === 'domain_register' ? 'register' : 'transfer';
  const price = priceForYears(catalog, kind, input.years, currency);
  const renew = priceForYears(catalog, 'renew', 1, currency);
  if (!price || !renew) {
    throw new AppError('domain_price_missing', `No ${currency} price configured for .${tld}`, 409);
  }
  const verb = kind === 'register' ? 'Domain registration' : 'Domain transfer';
  return {
    type: input.type,
    domainName: input.domain,
    tld,
    registrarModule: catalog.registrarModule,
    quantity: input.years,
    billingCycle: cycleForYears(input.years),
    currency,
    amount: price.amount,
    setupFee: 0,
    renewAmountPerYear: renew.perYear,
    description: `${verb}: ${input.domain} (${input.years} ${input.years === 1 ? 'year' : 'years'})`,
    config: {
      years: input.years,
      ...(input.eppCode ? { eppCode: input.eppCode } : {}),
      ...(input.nameservers ? { nameservers: input.nameservers } : {}),
      ...(input.registrantContactId ? { registrantContactId: input.registrantContactId } : {}),
      ...(input.contacts ? { contacts: input.contacts } : {}),
      idProtection: input.idProtection,
      autoRenew: input.autoRenew,
      additionalFields: input.additionalFields,
    },
  };
}

/**
 * Called by the orders module once the order's invoice is paid: creates the `domains` row and
 * enqueues `domains:register` / `domains:transfer`. Returns the domain so the caller can set
 * `order_items.domain_id`. Idempotent per domain name (an existing non-cancelled row is a conflict).
 */
export async function activateDomainOrderItem(
  db: Db,
  item: Pick<DomainOrderItem, 'type' | 'domainName' | 'config' | 'registrarModule'>,
  clientId: string,
  opts: { appKey?: string } = {},
): Promise<{ domain: Domain; job: { queue: 'domains'; name: string; id: string } }> {
  const base = {
    domain: item.domainName,
    years: item.config.years,
    nameservers: item.config.nameservers,
    registrantContactId: item.config.registrantContactId,
    contacts: item.config.contacts,
    idProtection: item.config.idProtection,
    autoRenew: item.config.autoRenew,
    additionalFields: item.config.additionalFields,
    registrarModule: item.registrarModule ?? undefined,
  };
  if (item.type === 'domain_transfer') {
    if (!item.config.eppCode) throw badRequest('transfer item has no EPP code');
    return startTransfer(db, { ...base, eppCode: item.config.eppCode }, clientId, opts.appKey);
  }
  return startRegistration(db, base, clientId);
}

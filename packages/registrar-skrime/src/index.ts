import {
  type AvailabilityResult,
  type DomainDTO,
  type DomainInfo,
  type DomainResult,
  defineRegistrar,
  type ModuleContext,
  type RegisterRequest,
  type TldPrice,
} from '@provisia/module-sdk';
import { z } from 'zod';
import { SKRIME_DEFAULT_BASE_URL, SkrimeClient } from './client.js';
import { SkrimeError } from './errors.js';
import {
  fromSkrimeContact,
  mapDomainStatus,
  mapPriceRow,
  type SkrimeContact,
  type SkrimeDomainSingle,
  type SkrimePriceRow,
  toIsoDate,
  toSkrimeContact,
} from './mapping.js';

export * from './client.js';
export * from './errors.js';
export * from './mapping.js';

export const skrimeConfigSchema = z.object({
  /** Personal API token from https://skrime.eu/api (dashboard > API Schnittstelle). */
  apiKey: z.string().min(1),
  /**
   * Skrime has no sandbox environment. With `sandbox: true` every *mutating* call (order, renew,
   * nameserver/contact update) is logged and answered locally with `status: 'pending'`; read-only
   * calls (check, single, pricelist, authcode) still hit the live API. Use it on staging.
   */
  sandbox: z.boolean().default(false),
  /** Override to point at a mock server in integration tests. */
  baseUrl: z.url().default(SKRIME_DEFAULT_BASE_URL),
  /** Used when a register/transfer request carries no nameservers. */
  defaultNameservers: z.array(z.string().min(1)).max(5).default([]),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  /** GET parameters as query string (default) or as JSON body (how Skrime documents it). */
  getParamsIn: z.enum(['query', 'body']).default('query'),
});
export type SkrimeConfig = z.infer<typeof skrimeConfigSchema>;

type Ctx = ModuleContext<SkrimeConfig>;

export function createClient(
  ctx: Ctx,
  extra: Partial<ConstructorParameters<typeof SkrimeClient>[0]> = {},
) {
  return new SkrimeClient({
    apiKey: ctx.config.apiKey,
    baseUrl: ctx.config.baseUrl,
    fetch: ctx.fetch,
    logger: ctx.logger,
    timeoutMs: ctx.config.timeoutMs,
    getParamsIn: ctx.config.getParamsIn,
    ...extra,
  });
}

function nameserversFor(ctx: Ctx, ns: string[] | undefined): string[] {
  const list = (ns ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return (list.length ? list : ctx.config.defaultNameservers).slice(0, 5);
}

function orderPayload(ctx: Ctx, req: RegisterRequest, authCode: string) {
  const contact = toSkrimeContact(req.contacts.registrant);
  return {
    domain: req.domain.toLowerCase(),
    authCode,
    contact: { ...contact, nameserver: nameserversFor(ctx, req.nameservers) },
    // Skrime requires explicit acceptance of its terms and the waiver of the EU cancellation right.
    tos: true,
    cancellation: true,
  };
}

async function order(
  ctx: Ctx,
  req: RegisterRequest,
  authCode: string,
  kind: 'register' | 'transfer',
): Promise<DomainResult> {
  if (req.years !== 1) {
    ctx.logger.warn(
      { domain: req.domain, years: req.years },
      'skrime orders are always 1 year; the requested period is recorded in moduleData only',
    );
  }
  if (req.additionalFields && Object.keys(req.additionalFields).length) {
    ctx.logger.debug({ domain: req.domain }, 'skrime ignores additionalFields');
  }
  const payload = orderPayload(ctx, req, authCode);
  if (ctx.config.sandbox) {
    ctx.logger.info(
      { domain: req.domain, kind, payload: { ...payload, authCode: authCode ? '***' : '' } },
      'skrime sandbox: order not sent',
    );
    return {
      status: 'pending',
      message: `sandbox: ${kind} of ${req.domain} simulated`,
      moduleData: { sandbox: true, requestedYears: req.years, kind },
    };
  }
  const data = await createClient(ctx).post<SkrimeDomainSingle>('domain/order', payload);
  const expiryDate = toIsoDate(data?.expireAt);
  return {
    status: expiryDate ? 'completed' : 'pending',
    ...(expiryDate ? { expiryDate } : {}),
    moduleData: { requestedYears: req.years, kind, orderedAt: new Date().toISOString() },
    message: `${kind} order accepted by Skrime`,
  };
}

const skrime = defineRegistrar({
  id: 'skrime',
  name: 'SKRIME',
  version: '0.1.0',
  configSchema: skrimeConfigSchema,

  async checkAvailability(ctx, domains): Promise<AvailabilityResult[]> {
    const client = createClient(ctx);
    const results: AvailabilityResult[] = [];
    // Skrime checks one name per request; run a few in parallel, never fail the whole batch.
    const batch = 5;
    for (let i = 0; i < domains.length; i += batch) {
      const slice = domains.slice(i, i + batch);
      const settled = await Promise.allSettled(
        slice.map((domain) =>
          client.post<{
            available?: boolean;
            premium?: boolean;
            price?: number | string;
            currency?: string;
          }>('domain/check', { domain: domain.toLowerCase() }),
        ),
      );
      settled.forEach((r, idx) => {
        const domain = (slice[idx] ?? '').toLowerCase();
        if (r.status === 'fulfilled') {
          const out: AvailabilityResult = { domain, available: Boolean(r.value?.available) };
          if (r.value?.premium) out.premium = true;
          if (r.value?.price !== undefined && r.value.price !== null) {
            const cents = Math.round(Number(r.value.price) * 100);
            if (Number.isFinite(cents))
              out.price = { amount: cents, currency: (r.value.currency ?? 'EUR').toUpperCase() };
          }
          results.push(out);
        } else {
          const err = r.reason;
          const reason = err instanceof Error ? err.message : String(err);
          ctx.logger.warn({ domain, err: reason }, 'skrime availability check failed');
          results.push({ domain, available: false, reason });
        }
      });
    }
    return results;
  },

  register(ctx, req) {
    return order(ctx, req, '', 'register');
  },

  async transfer(ctx, req) {
    if (!req.eppCode)
      throw new SkrimeError('invalid_auth_code', 'transfer requires an EPP/auth code');
    return order(ctx, req, req.eppCode, 'transfer');
  },

  async renew(ctx, domain, years): Promise<DomainResult> {
    if (years !== 1) {
      ctx.logger.warn(
        { domain: domain.name, years },
        'skrime renews one year per call; renewing once',
      );
    }
    if (ctx.config.sandbox) {
      ctx.logger.info({ domain: domain.name }, 'skrime sandbox: renew not sent');
      return {
        status: 'pending',
        message: 'sandbox: renewal simulated',
        moduleData: { sandbox: true },
      };
    }
    const client = createClient(ctx);
    await client.post('domain/renew', { domain: domain.name });
    // The renew response carries no dates; read them back (best effort).
    try {
      const info = await client.get<SkrimeDomainSingle>('domain/single', { domain: domain.name });
      const expiryDate = toIsoDate(info?.expireAt);
      return { status: 'completed', ...(expiryDate ? { expiryDate } : {}), message: 'renewed' };
    } catch (err) {
      ctx.logger.warn({ domain: domain.name, err }, 'renewed but could not read back expiry');
      return { status: 'pending', message: 'renew accepted; expiry will be refreshed by sync' };
    }
  },

  async getInfo(ctx, domain): Promise<DomainInfo> {
    const client = createClient(ctx);
    let single: SkrimeDomainSingle;
    try {
      single = await client.get<SkrimeDomainSingle>('domain/single', { domain: domain.name });
    } catch (err) {
      if (err instanceof SkrimeError && err.code === 'not_found') {
        // The reference module treated "No product found" as cancelled; we report `unknown` and
        // let the sync job raise an admin alert instead of silently cancelling.
        return {
          status: 'unknown',
          expiryDate: null,
          nameservers: [],
          locked: null,
          idProtection: null,
        };
      }
      throw err;
    }
    let nameservers = Array.isArray(single.nameserver) ? single.nameserver : [];
    if (!nameservers.length) {
      try {
        const ns = await client.get<{ nameserver?: string[] }>('domain/nameserver', {
          domain: domain.name,
        });
        nameservers = Array.isArray(ns?.nameserver) ? ns.nameserver : [];
      } catch (err) {
        ctx.logger.debug({ domain: domain.name, err }, 'nameserver lookup failed');
      }
    }
    const privacy = single.whoisPrivacy ?? single.privacy;
    return {
      status: mapDomainStatus(single),
      expiryDate: toIsoDate(single.expireAt),
      nameservers: nameservers.filter((n): n is string => typeof n === 'string' && n.length > 0),
      locked: typeof single.locked === 'boolean' ? single.locked : null,
      idProtection: typeof privacy === 'boolean' ? privacy : null,
      autoRenew: typeof single.autoRenew === 'boolean' ? single.autoRenew : null,
    };
  },

  async setNameservers(ctx, domain, ns): Promise<void> {
    const nameserver = nameserversFor(ctx, ns);
    if (ctx.config.sandbox) {
      ctx.logger.info({ domain: domain.name, nameserver }, 'skrime sandbox: nameservers not sent');
      return;
    }
    await createClient(ctx).post('domain/nameserver', { domain: domain.name, nameserver });
  },

  async getEppCode(ctx, domain): Promise<string> {
    const data = await createClient(ctx).get<{ authcode?: string; authCode?: string }>(
      'domain/authcode',
      {
        domain: domain.name,
      },
    );
    const code = data?.authcode ?? data?.authCode;
    if (!code)
      throw new SkrimeError(
        'invalid_response',
        'Skrime returned no auth code',
        undefined,
        false,
        data,
      );
    return code;
  },

  async setContacts(ctx: Ctx, domain, contacts): Promise<void> {
    const contact = toSkrimeContact(contacts.registrant);
    if (ctx.config.sandbox) {
      ctx.logger.info({ domain: domain.name }, 'skrime sandbox: contact update not sent');
      return;
    }
    await createClient(ctx).post('domain/contact', { domain: domain.name, contact });
  },

  // setLock: intentionally absent. Neither the WHMCS reference nor Skrime's public docs expose a
  // registrar-lock endpoint. The API module answers `registrar_unsupported` for lock changes.

  async getTldPricing(ctx: Ctx): Promise<TldPrice[]> {
    const data = await createClient(ctx).get<SkrimePriceRow[] | { pricelist?: SkrimePriceRow[] }>(
      'domain/pricelist',
    );
    const rows = Array.isArray(data) ? data : Array.isArray(data?.pricelist) ? data.pricelist : [];
    return rows.filter((r) => r && typeof r.tld === 'string').map(mapPriceRow);
  },
});

export default skrime;

/**
 * Skrime features outside the `Registrar` contract. Not called by the core yet; exposed for a
 * future DNS-management UI.
 */
export const skrimeExtras = {
  async getContacts(ctx: Ctx, domain: DomainDTO) {
    const data = await createClient(ctx).get<{ contact?: Partial<SkrimeContact> }>(
      'domain/contact',
      {
        domain: domain.name,
      },
    );
    return fromSkrimeContact(data?.contact ?? {});
  },
  async getDns(ctx: Ctx, domain: DomainDTO) {
    const data = await createClient(ctx).get<{
      records?: Array<{ name: string; type: string; data: string; priority?: number }>;
    }>('domain/dns', { domain: domain.name });
    return data?.records ?? [];
  },
  async setDns(
    ctx: Ctx,
    domain: DomainDTO,
    records: Array<{ name: string; type: string; data: string; priority?: number }>,
  ) {
    if (ctx.config.sandbox) return;
    await createClient(ctx).post('domain/dns', { domain: domain.name, records });
  },
  async listDomains(ctx: Ctx) {
    const data = await createClient(ctx).get<SkrimeDomainSingle[]>('domain/all');
    return Array.isArray(data) ? data : [];
  },
};

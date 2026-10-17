import { type ViesCheckResult, type ViesClient, ViesUnavailableError } from './types.js';

export const VIES_REST_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ViesRestClientOptions {
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchLike;
  url?: string;
  timeoutMs?: number;
  /** Requester identification is optional; when set VIES returns a `requestIdentifier`. */
  requester?: { countryCode: string; vatNumber: string };
  now?: () => Date;
}

interface ViesRestResponse {
  countryCode?: string;
  vatNumber?: string;
  requestDate?: string;
  valid?: boolean;
  requestIdentifier?: string;
  name?: string;
  address?: string;
  traderName?: string;
  traderAddress?: string;
  userError?: string;
  actionSucceed?: boolean;
  errorWrappers?: Array<{ error?: string; message?: string }>;
}

const UNAVAILABLE_CODES = new Set([
  'MS_UNAVAILABLE',
  'MS_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'SERVER_BUSY',
  'VAT_BLOCKED',
  'IP_BLOCKED',
]);

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.replace(/\s+/g, ' ').trim();
  return v === '' || v === '---' ? null : v;
}

/**
 * VIES REST adapter. Pure HTTP; caching lives in the persistence layer (`@provisia/core/db`).
 * Only `ViesUnavailableError` is thrown for outages so callers can keep the previous cached result.
 */
export function createViesRestClient(options: ViesRestClientOptions = {}): ViesClient {
  const doFetch: FetchLike = options.fetch ?? ((i, init) => fetch(i, init));
  const url = options.url ?? VIES_REST_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => new Date());

  return {
    async checkVat(countryCode, vatNumber): Promise<ViesCheckResult> {
      const body: Record<string, string> = { countryCode, vatNumber };
      if (options.requester) {
        body.requesterMemberStateCode = options.requester.countryCode;
        body.requesterNumber = options.requester.vatNumber;
      }
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new ViesUnavailableError('VIES request failed', err);
      }
      if (res.status >= 500 || res.status === 429) {
        throw new ViesUnavailableError(`VIES responded with HTTP ${res.status}`);
      }
      let data: ViesRestResponse;
      try {
        data = (await res.json()) as ViesRestResponse;
      } catch (err) {
        throw new ViesUnavailableError('VIES returned a non-JSON response', err);
      }
      const errorCode = data.userError ?? data.errorWrappers?.[0]?.error;
      if (errorCode && errorCode !== 'VALID' && errorCode !== 'INVALID') {
        if (UNAVAILABLE_CODES.has(errorCode)) {
          throw new ViesUnavailableError(`VIES: ${errorCode}`);
        }
        // INVALID_INPUT and friends: the number is malformed → treat as invalid, not an outage.
        return {
          valid: false,
          countryCode,
          vatNumber,
          name: null,
          address: null,
          requestIdentifier: null,
          checkedAt: now(),
        };
      }
      if (!res.ok) throw new ViesUnavailableError(`VIES responded with HTTP ${res.status}`);
      return {
        valid: data.valid === true,
        countryCode: data.countryCode ?? countryCode,
        vatNumber: data.vatNumber ?? vatNumber,
        name: clean(data.name ?? data.traderName),
        address: clean(data.address ?? data.traderAddress),
        requestIdentifier: clean(data.requestIdentifier),
        checkedAt: now(),
      };
    },
  };
}

/** Deterministic fake for tests and local dev (`VIES_FAKE=1`): numbers ending in `00` are invalid. */
export function createFakeViesClient(overrides: Partial<Record<string, boolean>> = {}): ViesClient {
  return {
    async checkVat(countryCode, vatNumber) {
      const key = `${countryCode}${vatNumber}`;
      const valid = overrides[key] ?? !vatNumber.endsWith('00');
      return {
        valid,
        countryCode,
        vatNumber,
        name: valid ? 'Test Trader B.V.' : null,
        address: valid ? 'Teststraat 1, 1234 AB Amsterdam' : null,
        requestIdentifier: null,
        checkedAt: new Date(),
      };
    },
  };
}

# @provisia/registrar-skrime

Registrar module for [SKRIME](https://skrime.eu) (German reseller, EUR pricing). Ported to
TypeScript from the WHMCS module `tomgewiese/SKRIME-WHMCS-DOMAIN` (MIT) and implemented against the
`Registrar` interface of `@provisia/module-sdk`.

## Configuration (`configSchema`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | string | required | Personal API token: skrime.eu dashboard > *API Schnittstelle* (`https://skrime.eu/api`). Stored encrypted in `registrar_accounts`. |
| `sandbox` | boolean | `false` | Skrime has **no sandbox environment**. With `true`, every mutating call (order, renew, nameserver and contact updates, DNS writes) is logged and answered locally with `status: 'pending'`; read calls still hit the live API. |
| `baseUrl` | url | `https://skrime.eu/api` | Override to point at a mock server. |
| `defaultNameservers` | string[] | `[]` | Used when a register/transfer request has no nameservers. |
| `timeoutMs` | number | `30000` | Per request. |

## Endpoint mapping

All requests carry `Authorization: Bearer <apiKey>`, `Content-Type: application/json`. Every
response is an envelope `{ state: 'success' | 'error', response: '<message>', data?: ... }`.

| `Registrar` method | HTTP | Endpoint | Request | Response used |
|---|---|---|---|---|
| `checkAvailability(domains)` | POST | `domain/check` (one call per name, 5 in parallel) | `{ domain }` | `data.available`, optional `data.premium`, `data.price` |
| `register(req)` | POST | `domain/order` | `{ domain, authCode: '', contact: { company, firstname, lastname, street, number, postcode, city, state, country, email, phone, nameserver: [] }, tos: true, cancellation: true }` | `data.expireAt` if present → `completed`, else `pending` |
| `transfer(req)` | POST | `domain/order` | same as register with `authCode: req.eppCode` | same |
| `renew(domain, years)` | POST | `domain/renew` then GET `domain/single` | `{ domain }` | `data.expireAt` from the read-back |
| `getInfo(domain)` | GET | `domain/single` (+ `domain/nameserver` when `single` has no `nameserver`) | `?domain=` | `expireAt`, `status`/`state`, `nameserver[]`, `whoisPrivacy`, `locked`, `autoRenew` |
| `setNameservers(domain, ns)` | POST | `domain/nameserver` | `{ domain, nameserver: [] }` | – |
| `getEppCode(domain)` | GET | `domain/authcode` | `?domain=` | `data.authcode` |
| `setContacts(domain, contacts)` | POST | `domain/contact` | `{ domain, contact: {…registrant} }` (Skrime has one owner contact per domain) | – |
| `getTldPricing()` | GET | `domain/pricelist` | – | `[{ tld, create, renew, transfer, restore }]` euros → cents, `minYears 1`, `maxYears 10` |
| `setLock` | – | **not implemented** | Neither the reference module nor the public docs expose a registrar-lock endpoint. The API module returns `registrar_unsupported`. |
| `skrimeExtras.getContacts` | GET | `domain/contact` | `?domain=` | `data.contact` |
| `skrimeExtras.getDns` / `setDns` | GET / POST | `domain/dns` | `?domain=` / `{ domain, records: [{ name, type, data, priority? }] }` | `data.records` |
| `skrimeExtras.listDomains` | GET | `domain/all` | – | `data[]` |

Documented by Skrime but not wired (no reference implementation): `DNSSEC` (GET/POST/DELETE) and
`Whois Privacy aktualisieren` (POST).

### Behavioural notes / deviations from the PHP module

- **GET parameters**: Guzzle sent a JSON body on GET. Fetch forbids that, so GET parameters go in the
  query string (`domain/single?domain=example.nl`). Confirm on the first live run (below).
- **Years**: Skrime orders/renews one year per call (the PHP module had no period parameter). A request
  for more years logs a warning and records `requestedYears` in `moduleData`; the worker charges what the
  TLD catalog says, so keep multi-year prices equal to 1 year × N or set `maxYears = 1` for Skrime TLDs.
- **"No product found"**: the PHP module mapped this to *cancelled*. We return `DomainInfo.status = 'unknown'`;
  the sync job raises an admin alert instead of cancelling.
- **Organisation name**: the PHP module deleted `( ) Ä Ö Ü`; we strip parentheses and transliterate umlauts.
- **Address**: `address1` is split into `street` + `number` with the reference regex; when no number is
  found, `address2` is used as the number.
- **Transfers** are plain `domain/order` calls with an auth code; the registrar processes them
  asynchronously, so `transfer()` returns `pending` and `domains:sync` promotes the domain to `active`.

## Error mapping

`SkrimeError { code, httpStatus, retryable, raw }`:

| Condition | `code` | retried |
|---|---|---|
| HTTP 401/403 | `auth_failed` | no |
| HTTP 404 or message "No product found" | `not_found` | no |
| HTTP 429 | `rate_limited` | yes |
| HTTP 5xx, network failure, timeout | `upstream_error` / `network_error` | yes (3 attempts, 500 ms × 2ⁿ + jitter) |
| 200 with non-JSON body | `invalid_response` | no |
| `state !== 'success'` | keyword match: `domain_unavailable`, `insufficient_funds`, `invalid_auth_code`, `validation_failed`, `auth_failed`, else `upstream_error` | no |

## Tests

```sh
pnpm --filter @provisia/registrar-skrime test
```

All HTTP is mocked with `msw` (`src/skrime.test.ts`): every method, the payload shape, sandbox mode,
retry/backoff, and each error class. No live credentials are used.

## Sandbox / first live run

Skrime offers no test environment, so "sandbox" here means staged rollout:

1. Create an account on skrime.eu, top up a small balance and copy the API token from *API Schnittstelle*.
2. In Provisia admin: `PUT /api/v1/admin/registrars/skrime` with
   `{ "config": { "apiKey": "<token>", "sandbox": true } }`.
3. Read-only checks (safe): `POST /api/v1/admin/tlds/import-pricing { registrarModule: "skrime" }`
   (job `domains:importPricing`), `GET /api/v1/public/domains/availability?sld=test&tlds=de`. If
   these fail with `invalid_response`, Skrime's GET endpoints may expect the `domain` parameter in a JSON
   body rather than the query string; report it as an issue with the `domain_sync_log` details.
4. Flip `sandbox` to `false`, register one cheap domain via the admin action and watch
   `domains:register` → `domains:sync` move it from `pending_registration` to `active`.
5. Trigger a manual sync (`POST /api/v1/admin/domains/:id/sync`) and compare `expiryDate`/nameservers
   with the Skrime dashboard.

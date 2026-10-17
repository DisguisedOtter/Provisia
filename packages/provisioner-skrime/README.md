# @provisia/provisioner-skrime

Resell [SKRIME](https://skrime.eu) webspace and KVM servers from Provisia. Two provisioners share one
API client (`SkrimeClient` from `@provisia/registrar-skrime`, same key, same `{ state, response, data }`
envelope):

| Module id | Product type | What a Provisia service maps to |
|---|---|---|
| `skrime_webspace` | `hosting` | one webspace (Plesk) product in the reseller's Skrime account |
| `skrime_server` | `vps` | one KVM server product in the reseller's Skrime account |

Skrime bills the reseller account (prepaid balance, monthly); Provisia bills the client at your own
price. The Skrime price seen at order time is stored in `services.module_data.costAmount` (cents) for
margin reporting.

## Setup

1. **Server** (admin → Servers → New): module `skrime_webspace` or `skrime_server`, hostname `skrime.eu`,
   group e.g. `skrime`, credentials `{ "apiKey": "<token from skrime.eu → API Schnittstelle>" }`.
   One Skrime account can back both modules: create two server rows with the same key. `Test connection`
   calls `GET product/all`.
2. **Product**: type `hosting` (webspace) or `vps` (server), module as above, server group `skrime`.
   Module config:

   | Module | Key | Notes |
   |---|---|---|
   | `skrime_webspace` | `package` | Skrime package id; the product form offers `listRemoteOptions('package')` = `GET webspace/pricelist` |
   | | `suspendMode` | `password` (default: rotate the panel password, Skrime has no suspend call) or `none` |
   | `skrime_server` | `plan`, `image` | from `GET server/pricelist` / `GET server/images` |
   | | `hostnamePrefix` | hostname when the service has no domain (`vps-` + service id suffix) |
   | | `suspendMode` | `power_off` (default) or `none` |

3. Set your prices on the product; keep an eye on the Skrime balance (`insufficient_funds` errors fail
   the provisioning job and raise an admin notification).

## Endpoint mapping

All in `src/endpoints.ts`. **Verify against https://skrime.eu/docs on the first live run**: the domain
endpoints of the registrar module are proven, the webspace/server ones follow the same scheme but were
written without a live account. Responses are parsed defensively (`id`/`productId`, `ip`/`ipv4`,
`status`/`state`, `panel.url`/`loginUrl`, …), so small naming differences do not need code changes;
different paths do (one line each).

| Provisioner method | Webspace | Server |
|---|---|---|
| `testConnection` | `GET product/all` | `GET product/all` |
| `listRemoteOptions(kind)` | `package` → `GET webspace/pricelist` | `plan` → `GET server/pricelist`, `image` → `GET server/images` |
| `create` | `POST webspace/order { package, domain, tos }` (+ `GET webspace/single?id=` read-back, `POST webspace/password` when no password is known) | `POST server/order { plan, image, hostname, password, tos }` (+ `GET server/single?id=` for the IP) |
| `suspend` / `unsuspend` | `POST webspace/password` (random / stored password) | `POST server/power { action: stop / start }` |
| `terminate` | `POST webspace/cancel { id }` | `POST server/cancel { id }` |
| `changePackage` | `POST webspace/upgrade { id, package }` | `POST server/upgrade { id, plan }` |
| `changePassword` | `POST webspace/password { id, password }` | `POST server/password { id, password }` |
| `getUsage` | `GET webspace/single?id=` | `GET server/single?id=` (power state, cpu/ram/disk, ip) |
| `loginUrl` | `GET webspace/login?id=` → `url`, falls back to the stored panel url | – |
| `power(action)` | – | `POST server/power { id, action }` (`reboot` → `restart`) |
| `reinstallSkrimeServer()` | – | `POST server/reinstall { id, image, password }` |

Cancellation at Skrime takes effect at the end of the paid term; `terminate` records `cancelledAt` in
`module_data` and does not fail when the product is already gone.

## Tests

```sh
pnpm --filter @provisia/provisioner-skrime test
```

All HTTP is mocked (`src/test-utils.ts`), covering both provisioners, payload shapes, error mapping and
the defensive response parsing. No live credentials are used.

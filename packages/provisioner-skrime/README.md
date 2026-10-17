# @provisia/provisioner-skrime

Resell [SKRIME](https://skrime.eu) webspace and KVM servers from Provisia. Two provisioners share the API
client of `@provisia/registrar-skrime` (same token, same `{ response, state, data }` envelope), mapped
from the official API documentation (dashboard → *API Dokumentation*, sections *Produkt*, *Webspace*,
*KVM Server*).

| Module id | Product type | One Provisia service = |
|---|---|---|
| `skrime_webspace` | `hosting` | one webspace plan (Plesk) in the reseller's Skrime account |
| `skrime_server` | `vps` | one KVM server product in the reseller's Skrime account |

Skrime bills the reseller account (prepaid balance); Provisia bills the client at your own price. The Skrime
recurring price seen at order time is stored in `services.module_data.costAmount` (cents) for margin reporting.

## Setup

1. **Server** (admin → Servers → New): module `skrime_webspace` or `skrime_server`, hostname `skrime.eu`,
   group e.g. `skrime`, credentials `{ "apiKey": "<token>" }`. One Skrime account can back both modules
   (two server rows, same key). *Test connection* calls `GET product/all`.
   Optional credential `getParamsIn`: `query` (default) or `body` — Skrime documents GET parameters as a
   JSON body; if the read calls (`product/all`, `server/information`, ...) fail with `invalid_response` or
   "missing parameter", switch to `body`.
2. **Product**: type `hosting` (webspace) or `vps` (server), module as above, server group `skrime`.

   | Module | Key | Notes |
   |---|---|---|
   | `skrime_webspace` | `planId` | plan UUID; the product form offers `listRemoteOptions('plan')` = `GET webspace/pricelist` |
   | | `renewal` | `autorenew` (default: `product/autorenew = true` after ordering) or `manual` |
   | | `suspendMode` | `password` (default, rotates the panel password) or `none` |
   | `skrime_server` | `planId` **or** `cores`, `memoryGb`, `diskGb` (+ `ipv4`, `ipv6`, `connection`) | fixed plan (`GET server/pricelist`) or the configurator |
   | | `osName` | `proxmoxId` from `listRemoteOptions('image')` = `GET server/os`, e.g. `debian-12` |
   | | `prepayMonths` | 1, 2, 3, 6, 12 or 24 months paid at Skrime per order |
   | | `renewal`, `suspendMode` (`power_off` / `none`), `hostnamePrefix` | |

3. Keep an eye on the Skrime balance: `insufficient_funds` fails the provisioning job and raises an admin
   notification.

## Lifecycle mapping

| Provisioner method | Webspace | Server |
|---|---|---|
| `create` | `POST webspace/order { planId, tos, cancellation }` → `GET webspace/information` (panel host, username, password) → `POST product/autorenew` → `POST product/name` | `POST server/order { osName, password, tos, cancellation, notice, prepayMonths, planId \| configurator }` → `POST product/autorenew` → `POST product/name` → `GET server/information { lazy }` (IP once installed) |
| `suspend` / `unsuspend` | `POST webspace/passwd` (random / stored password) | `POST server/action { stop }` / `{ start }` |
| `terminate` | `POST product/autorenew { false }` (expires at the end of the paid term) | same, then `server/action { stop }` |
| `changePackage` | `POST webspace/upgrade { planId }` | – (order a new server) |
| `changePassword` | `POST webspace/passwd` | `POST server/passwd` |
| `getUsage` | `GET webspace/information` (disk MB) | `GET server/information` (cpu %, memory, disk, power state, IP) |
| `loginUrl` | `GET webspace/login` (Plesk SSO) | `GET server/novnc` (console) |
| `power` | – | `start` / `stop`; `shutdown` = stop, `reboot` = stop + start |

## Extra actions (`/services/:id/extras/:action`)

Exposed to the client portal (and staff) through the generic module-action endpoints; the portal renders
a *Server tools* card with console, network + rDNS, firewall, backups and reinstall.

| Action | Audience | Skrime call |
|---|---|---|
| `console` | client | `GET server/novnc` → `{ url }` |
| `network` | client | `GET server/network` → `{ ipv4[], ipv6[] }` |
| `rdns.set` / `rdns.delete` | client | `POST` / `DELETE server/rdns` |
| `firewall.list` / `firewall.create` / `firewall.edit` / `firewall.move` / `firewall.delete` | client | `GET` / `POST` / `DELETE server/firewall` |
| `ddos.stats` / `ddos.attacks` | client | `GET server/ddos { scope }` |
| `statistics` | client | `GET server/statistic { period }` |
| `backup.list` / `backup.restore` | client | `GET` / `POST server/backup` |
| `os.list` | client | `GET server/os` |
| `reinstall` | client | `DELETE server/reinstall` → new root password (stored by the worker, shown once) |
| `ip.add` | staff | `POST server/ip` (paid) |
| `product.log` | staff | `GET product/log` |
| webspace `info` / `reinstall` | client | `GET webspace/information` / `DELETE webspace/reinstall` |

## Tests

```sh
pnpm --filter @provisia/provisioner-skrime test
```

All HTTP is mocked (`src/test-utils.ts`): both provisioners, every documented payload, the extras, error
mapping and both GET parameter modes (query string and JSON body against a local HTTP server).

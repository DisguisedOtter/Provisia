# @provisia/provisioner-plesk

Provisioner module for **Plesk Obsidian** using the REST API (`https://host:8443/api/v2`).
Module id: `plesk`.

## Mapping

| Provisia action | Plesk REST call |
|---|---|
| create | `POST /clients` (optional) + `POST /domains` with `plan: { name }` |
| suspend / unsuspend | `PUT /domains/{id}/status` → `suspended` / `active` |
| terminate | `DELETE /domains/{id}` then `DELETE /clients/{id}` (404s are ignored) |
| changePackage | `POST /cli/subscription/call` `--switch-subscription <domain> -service-plan <plan>` |
| changePassword | `POST /cli/customer/call --update … -passwd` and `POST /cli/subscription/call --update … -login … -passwd` |
| getUsage | `GET /domains/{id}/statistics` (Plesk 18.0.50+; older versions return 404 → usage sync fails but nothing else) |
| loginUrl | `POST /auth/keys { login }` → `https://host:8443/login?secret=<key>` (one-time, short-lived) |
| testConnection | `GET /server` |
| listRemoteOptions(`plans`) | `GET /service-plans` (hosting plans only) |

## Server credentials

Either an API key (recommended) or admin/reseller basic auth:

```json
{ "apiKey": "…" }
{ "username": "admin", "password": "…" }
```

Create an API key on the server: `plesk bin secret_key --create -ip-address <provisia-ip> -description provisia`
(or `POST /api/v2/auth/keys` with admin basic auth). Keys are bound to the IP they were created for unless
`-ip-address` is omitted. The REST API must be enabled (Tools & Settings » Remote API) and the key owner
needs the permissions to create customers and subscriptions (admin or a reseller with those rights).

## Product config

```json
{ "servicePlan": "Unlimited", "createCustomer": true, "ipAddress": "", "bindLoginToIp": false }
```

`servicePlan` must match a hosting service plan name (`GET /api/v1/admin/servers/:id/options/plans`).
With `createCustomer: true` (default) each service becomes a Plesk customer whose login = the service
username; SSO logs the client into that customer account. With `false` the subscription belongs to the
API user and SSO logs in as the subscription's system user.

## Module data

`{ customerId, customerLogin, domainId, domain, sysUser, servicePlan }` — `domainId` is the subscription id.

## Testing

`pnpm --filter @provisia/provisioner-plesk test` (mocked HTTP). Manual testing: Plesk's free trial license on
a fresh VM; the REST API is on by default. The `/statistics` endpoint and `/cli/*/call` gateway require Plesk
Obsidian 18.0.4x+.

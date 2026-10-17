# @provisia/provisioner-directadmin

Provisioner module for **DirectAdmin** (port 2222) using the `CMD_API_*` commands with login-key
authentication. Module id: `directadmin`. Every request sends `json=yes`; responses are decoded as JSON
when DirectAdmin honours it and as URL-encoded (`error=1&text=…&details=…`, `list[]=…`) otherwise.

## Mapping

| Provisia action | DirectAdmin command |
|---|---|
| create | `CMD_API_ACCOUNT_USER` (`action=create`), IP from `CMD_API_SHOW_RESELLER_IPS` when `ip=shared` |
| suspend / unsuspend / terminate | `CMD_API_SELECT_USERS` with `suspend=Suspend` / `unsuspend=Unsuspend` / `delete=yes&confirmed=Confirm` |
| changePackage | `CMD_API_MODIFY_USER` (`action=package`) |
| changePassword | `CMD_API_USER_PASSWD` |
| getUsage | `CMD_API_SHOW_USER_USAGE` + `CMD_API_SHOW_USER_CONFIG` (limits) |
| loginUrl | `CMD_API_LOGIN_KEYS` `type=one_time_url` executed as `admin|user` (login-as) |
| testConnection | `CMD_API_LICENSE` |
| listRemoteOptions(`packages`) | `CMD_API_PACKAGES_USER` |

## Server credentials

```json
{ "username": "admin", "loginKey": "…" }
```

Create a login key as the admin or reseller that will own the accounts: **Admin Level » Login Keys »
Create** (`CMD_LOGIN_KEYS`). Give it at least these commands: `CMD_API_ACCOUNT_USER`,
`CMD_API_SELECT_USERS`, `CMD_API_MODIFY_USER`, `CMD_API_USER_PASSWD`, `CMD_API_SHOW_USER_USAGE`,
`CMD_API_SHOW_USER_CONFIG`, `CMD_API_SHOW_RESELLER_IPS`, `CMD_API_PACKAGES_USER`, `CMD_API_LICENSE`,
`CMD_API_LOGIN_KEYS` (and tick "Allow HTM" off). Restrict it to Provisia's IP. The account password works
too but is discouraged. One-time URL login keys require DirectAdmin 1.56+ and the key must be allowed to
create keys; when creating keys with a login key, DirectAdmin expects the key itself in `passwd`.

## Product config

```json
{ "package": "basic", "ip": "shared", "notify": false, "loginKeyExpiry": "30m" }
```

`ip`: `shared` (first reseller IP), `server` (the server record's IP) or a literal address.

## Notes

- Usernames: derived from the domain (max 10 chars, lowercase, no leading digit) unless preset.
- DirectAdmin's `CMD_API_SHOW_USER_USAGE` reports MB; `unlimited` limits are returned as undefined.

## Testing

`pnpm --filter @provisia/provisioner-directadmin test` (mocked HTTP). DirectAdmin offers a free
"Personal" license tier and a public demo; a trial on a small VM is the practical sandbox.

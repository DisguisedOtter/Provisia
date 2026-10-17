# Auth, users, settings, activity, automation — API reference for UI agents

All paths are under `/api/v1`. Responses use `{ data }` / `{ data, meta }`; errors `{ error: { code, message, details? } }`.
Permissions in brackets. Shared zod schemas/types live in `@provisia/shared` (`auth.ts`, `users.ts`, `settings.ts`).
Security model: `docs/SECURITY.md`.

## Auth (`/auth/*`, public unless noted)

| Method & path | Body → Response | Notes |
|---|---|---|
| `POST /auth/login` | `LoginRequest {email,password,rememberMe?,totpCode?}` → `LoginResponse { data: AuthUser \| null, twoFactor?: {challengeToken, expiresAt} }` | `data` null ⇒ go to the 2FA step. Errors: `invalid_credentials` 401, `email_not_verified` 403, `too_many_attempts` 429 `{scope, retryAfterSeconds}`, `invalid_totp_code` 401 |
| `POST /auth/login/2fa` | `{challengeToken, code}` → `{ data: AuthUser }` | code = 6-digit TOTP or backup code |
| `POST /auth/logout` | → 204 | |
| `GET /auth/me` (auth) | → `{ data: AuthUser }` | `AuthUser` adds `clientId, permissions[], totpEnabled, totpEnrollmentRequired, impersonator` |
| `POST /auth/register` | `RegisterRequest` (EU address, `vatNumber?`, `acceptTerms: true`) → 201 `{ data: AuthUser, verificationRequired }` | `registration_disabled` 403, `email_taken` 409. Sets the cookie unless verification is required |
| `POST /auth/verify-email` | `{token}` → `{data:{ok:true}}` | `invalid_token` 400 |
| `POST /auth/resend-verification` | `{email}` → 204 | always 204 |
| `POST /auth/forgot-password` | `{email}` → 204 | always 204; mail key `auth.password_reset`, link `WEB_URL/reset-password?token=` |
| `GET /auth/reset-password?token=&type=reset\|invite` | → `{data:{valid, email}}` | pre-check for the form |
| `POST /auth/reset-password` | `{token, password}` → `{data:{ok:true}}` | revokes all sessions |
| `POST /auth/accept-invite` | `{token, password}` → `{ data: AuthUser }` + cookie | staff invite link: `WEB_URL/reset-password?token=&invite=1` |
| `POST /auth/change-password` (session) | `{currentPassword, newPassword}` → ok | keeps current session, revokes others |
| `GET /auth/sessions` (session) | → `{ data: Session[] }` | `current`, `rememberMe`, `impersonated`, `lastSeenAt` |
| `DELETE /auth/sessions/:id` / `DELETE /auth/sessions` (session) | → 204 / `{data:{revoked}}` | the latter revokes all *other* sessions |
| `GET /auth/2fa` (session) | → `{ data: TotpStatus }` | `enabled, confirmedAt, backupCodesRemaining, required` |
| `POST /auth/2fa/setup` (session) | → `{ data: { otpauthUrl, qrDataUrl, secret } }` | not enabled until confirmed; `totp_already_enabled` 409 |
| `POST /auth/2fa/confirm` (session) | `{code}` → `{ data: { backupCodes[] } }` | shown once |
| `POST /auth/2fa/backup-codes` (session) | `{code}` → new backup codes | |
| `POST /auth/2fa/disable` (session) | `{password, code}` → ok | |
| `GET/POST /auth/api-keys`, `DELETE /auth/api-keys/:id` (session) | `CreateApiKey {name, scopes[]=['*'], expiresAt?}` → 201 `{ data: CreatedApiKey }` (`token` once) | own keys |
| `POST /auth/impersonate` [clients.impersonate, session] | `{userId}` → `{ data: AuthUser }` (the client, with `impersonator`) | swaps the cookie; use the `userId` of the client's login (`client.userId`) |
| `POST /auth/impersonate/stop` (session) | → `{ data: AuthUser }` (the admin) | restores the admin cookie; `session_expired` 401 if it is gone |

Web: `/login` (2FA → `/2fa`), `/register`, `/forgot-password`, `/reset-password?token=[&invite=1]`,
`/verify-email?token=`, `/portal/account/security` (password, 2FA, sessions, API keys).
`components/impersonation-banner.tsx` is mounted in the portal layout; the admin layout can mount it too.
Hooks in `apps/web/lib/auth.ts`: `useMe`, `useLogout`, `useCan('clients.write')`, `useStopImpersonation`,
`usePublicSettings`, `postLoginPath`.

## Users & roles (`/admin/*`) — for the admin UI

| Path | Perm | Notes |
|---|---|---|
| `GET /admin/permissions` | users.read | `PermissionDescriptor[]` (`key, area, action, description`) |
| `GET /admin/roles`, `GET /admin/roles/:id` | users.read | `Role` with `userCount`, `isSystem` |
| `POST /admin/roles`, `PATCH /admin/roles/:id`, `DELETE /admin/roles/:id` | roles.manage | `CreateRole {name, description?, permissions[]}`; system roles: `role_is_system` 409 on delete |
| `GET /admin/users?search&active&role&page&perPage` | users.read | staff only (`admin`/`staff`), `StaffUser` adds `roles[], totpEnabled, invitePending` |
| `GET /admin/users/:id` | users.read | |
| `POST /admin/users` | users.manage | `CreateStaffUser {email,password,role,firstName,lastName,roleIds[]}` |
| `POST /admin/users/invite` | users.manage | `InviteStaffUser` (no password) → mail with accept link; `POST /admin/users/:id/resend-invite` |
| `PATCH /admin/users/:id` | users.manage | `UpdateStaffUser {email?,role?,firstName?,lastName?,active?,roleIds?}`; `cannot_modify_self`/`last_admin` 409 |
| `POST /admin/users/:id/disable` / `enable` | users.manage | disable revokes sessions + API keys |
| `POST /admin/users/:id/reset-2fa` | users.manage | removes the TOTP secret and sessions |
| `POST /admin/users/:id/unlock` | users.manage | clears the brute-force lock |
| `GET /admin/api-keys?includeRevoked`, `DELETE /admin/api-keys/:id` | users.manage | every key, with `userEmail` |

## Settings

- `GET /public/settings` → `PublicSettings` (company name/logo, locales, currency, timezone, date format,
  `allowRegistration`, `requireEmailVerification`). Use it on login/register pages.
- `GET /admin/settings` [settings.read] → `{ data: { group: values }, schemas: { group: JSONSchema } }`.
- `GET /admin/settings/:group` → `{ data, schema }`; `PUT /admin/settings/:group` [settings.manage] with a
  partial object. Groups: `company, localization, billing, dunning, tax, mail, security, automation, storage`
  (`settingsGroups` in shared). Secrets come back as `••••••••` (`SECRET_MASK`); send the mask to keep them.
- Server side: `getSettings(db, 'billing')` from `apps/api/src/lib/settings.ts` (30 s cache,
  `invalidateSettings()` on write) or `getAllSettings(db)` for the flat `Settings` object.

## Modules

`GET /admin/modules?kind=gateway|registrar|provisioner` [modules.read] → `{ kind, id, name, version,
capabilities: {…}, configSchema: <JSON Schema>, secretFields[] }`; `GET /admin/modules/:kind/:id`.
Render forms from `configSchema` (zod 4 `z.toJSONSchema`, input mode); mask `secretFields`.

## Activity

`GET /admin/activity?actorUserId&actorType&entityType&entityId&action=invoice.*&from&to&search&page`
[activity.read] → entries with `actorEmail`, `impersonatorEmail`, `diff`, `ip`, `userAgent`. `GET /admin/activity/:id`.

## Automation

| Path | Perm |
|---|---|
| `GET /admin/automation/jobs?queue&jobName&status&from&to` → `jobs_log` rows (+`durationMs`); `GET …/jobs/:id` | automation.read |
| `POST /admin/automation/jobs/:id/retry` → 202 `{queue, jobName, jobId, mode: retried\|reenqueued}` | automation.manage |
| `GET /admin/automation/schedules` → `{ id: 'queue:name', pattern, every, nextRunAt, lastRunAt, lastStatus }` | automation.read |
| `POST /admin/automation/run/:jobName` (`queue:name`) → 202 | automation.manage |
| `GET /admin/automation/queues` → depths + `deadLetter` per queue; `GET /admin/automation/dead-letter?queue=` | automation.read |

Worker `/health` on `WORKER_HEALTH_PORT` (3002): see `apps/worker/README.md`.

## Email contract used by this module

Jobs are enqueued on queue `email`, name `send`, payload `TemplateSendJob` (`@provisia/shared/email`):
`auth.welcome` (actionUrl = verify link or portal), `auth.password_reset` (also used for staff invites,
`actionUrl` = accept link, `ip` = inviter name), `auth.2fa_enabled`, `admin.notification` (daily summary).

## Tests

```sh
PGPASSWORD=provisia psql -h localhost -U provisia -d provisia -c 'create database provisia_auth'
export DATABASE_URL=postgres://provisia:provisia@localhost:5432/provisia_auth
pnpm --filter @provisia/db db:migrate && pnpm --filter @provisia/db exec drizzle-kit push --force
DATABASE_URL_TEST=$DATABASE_URL pnpm --filter @provisia/api test        # needs Redis on :6379
```

# Provisia — Security

How authentication, authorization and the platform hardening work, and what every feature agent must do to
stay inside the model. Companion to ARCHITECTURE.md §7. Owner: auth/platform agent.

## 1. Identities and credentials

| Credential | Storage | Notes |
|---|---|---|
| Password | argon2id (19 MiB, t=2, p=1), rehashed on login when parameters change | Min 10 chars, letters + a digit (`passwordSchema`). `password_changed_at` stamped on change/reset. |
| Session | `sessions` row, id in signed cookie `pv_session` | See §3. |
| API key | `pv_` + 40 chars, sha256 at rest, prefix shown in UI | Scopes (§4), `last_used_at/ip` tracked (throttled 1/min). Revocable; disabled users' keys are revoked. |
| TOTP secret | AES-256-GCM (`APP_KEY`) in `totp_secrets.secret_encrypted` | SHA-1/6 digits/30 s, ±1 step. 10 backup codes (`XXXXX-XXXXX`, 50 bits), sha256 hashed, single use. |
| Email tokens | `auth_tokens`: sha256 of a 32-byte random token, type, expiry, `used_at` | verify 24 h, reset 60 min (`security.passwordResetTtlMinutes`), invite 7 d, TOTP login challenge 5 min. Issuing a new token voids the previous one of the same type. |
| Settings secrets | `enc:v1:` AES-256-GCM via `@provisia/module-sdk` | `SECRET_SETTING_KEYS` (e.g. `mail.smtpPassword`); masked as `••••••••` on read; sending the mask back keeps the value. Never logged (audit diffs are built from masked values). |

Password reset and "resend verification" always return `204` (no account enumeration). Reset revokes every
session of the user. Changing the password keeps the current session and revokes the others.

## 2. Login flow

```
POST /auth/login {email,password,rememberMe,totpCode?}
  → lockout.check (Redis)                → 429 too_many_attempts {scope, retryAfterSeconds}
  → argon2 verify (constant-time dummy for unknown emails) → 401 invalid_credentials (+ lockout.fail)
  → requireEmailVerification && client && !verified        → 403 email_not_verified
  → TOTP enabled && !totpCode  → { data: null, twoFactor: { challengeToken, expiresAt } }
        POST /auth/login/2fa {challengeToken, code}   (TOTP or backup code; challenge single-use)
  → session + cookie; activity `auth.login`
```

Brute force (`lib/auth-lockout.ts`): per-account (`security.lockoutAccountAttempts`, default 5) and per-IP
(`lockoutIpAttempts`, 20) failure counters in a `lockoutWindowMinutes` (15) window; crossing a threshold locks
for `lockoutDurationMinutes` (15). Counters reset on success. Redis outage → fail open with a warning (the
per-route rate limit still applies). Admin unlock: `POST /admin/users/:id/unlock`.

Staff 2FA enforcement: `security.require2faForStaff` → `/me.totpEnrollmentRequired = true`; every guard
returns `403 totp_enrollment_required` outside `/api/v1/auth/*` until the user enrols
(`/portal/account/security?enroll=1`).

## 3. Sessions and cookies

- Cookie `pv_session`: `HttpOnly`, `SameSite=Lax`, signed (`SESSION_SECRET`), `Path=/`, `Secure` in
  production or when `APP_URL` is https. `rememberMe` → `Max-Age` = `SESSION_TTL_DAYS` (30) and the row
  expires then; otherwise a browser-session cookie whose row expires after `security.sessionTtlHours` (24).
- `last_seen_at` is updated at most every 5 minutes. Expired rows are purged by `maintenance:cleanupSessions`.
- Self-service: `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` (all others).
- CSRF: cookie-authenticated non-GET requests must send an `Origin` equal to `WEB_URL`/`APP_URL`
  (or no `Origin` and `Sec-Fetch-Site != cross-site`) → otherwise `403 csrf_origin_mismatch`. API-key requests
  are exempt. CORS allows only those two origins with credentials.
- Audit of the foundation flags: unchanged except `Secure` now also follows an https `APP_URL`, `Max-Age` is
  only set for remember-me, and browser-session cookies have a shorter server lifetime. A `__Host-` prefix
  was not adopted because the web app and API may live on different hosts in development.
- "Login as client": `POST /auth/impersonate {userId}` (permission `clients.impersonate`, session only)
  creates a client session with `impersonator_user_id` + `parent_session_id` (max 4 h), swaps the cookie,
  logs `auth.impersonate.start`. `/me.impersonator` drives the banner. Every audit row written during the
  session carries `impersonator_user_id`. Password/2FA/API-key self-service is blocked while impersonating.
  `POST /auth/impersonate/stop` deletes the client session and restores the admin cookie.

## 4. Authorization

- Roles: `users.role` ∈ `admin | staff | client`. `admin` implicitly holds `*`. `staff` hold the union of
  their `roles.permissions` (`user_roles`), `client` hold none. Seeded system roles: Admin (`*`), Support,
  Billing (`DEFAULT_ROLES` in `@provisia/shared/auth`); editable, not deletable.
- Permission strings: `<area>.<action>` (`clients.read`, `invoices.write`, `settings.manage`, …; full list
  `PERMISSIONS`). `area.write`/`area.manage` imply `area.read`; `area.*` and `*` are wildcards.
- Guards (`apps/api/src/lib/auth.ts`):
  - `requirePermission('clients.write')` — preferred for `/admin/*`.
  - `requireStaff` / `requireRole('admin','staff')` — coarse; still works for existing routes.
  - `requireClient` for `/portal/*`, `requireSession` for self-service (no API keys), `requireAuth`.
  - `can(req, 'x.y')` for conditional fields.
- API keys carry scopes in the same grammar; a request must satisfy **both** the user's permissions and the
  key's scopes → otherwise `403 insufficient_scope`.
- Status semantics: `401 unauthorized` = no/invalid credentials (also an invalid bearer token, and an
  expired/missing session); `403 forbidden` = authenticated but not allowed; `403 insufficient_scope`,
  `403 totp_enrollment_required`, `403 csrf_origin_mismatch`, `403 email_not_verified`,
  `403 registration_disabled`; `429 too_many_attempts` (lockout) vs `429 rate_limited` (rate limiter).
- Clients never see other clients' data: portal routes must filter by `req.auth.user.clientId`.

## 5. Audit log

`activity_log` records actor (user / api_key / system), impersonator, ip, user agent, action, entity and a
diff. Helpers: `activityLog(req, {...})`, `systemActivityLog(db, …)`, `entityDiff(before, after)` (changed
keys only, secrets redacted), `redactSecrets()`. A global `onResponse` hook (`modules/activity/hook.ts`)
writes a generic `admin.<method>` row with route/params/redacted body for any successful `/api/v1/admin/*`
mutation whose handler did not call `activityLog()`. Browse: `GET /admin/activity` (filters: actor, type,
entity, action prefix `invoice.*`, date range, search). Retention: `automation.activityLogRetentionDays`.

## 6. HTTP hardening (`plugins/security.ts`)

- Helmet: CSP `default-src 'self'; script/style 'self' 'unsafe-inline' (Swagger UI); img 'self' data:;
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` (+ `upgrade-insecure-requests`
  in production), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS 180 d in production,
  `Cross-Origin-Resource-Policy: cross-origin` (CORS governs browser access),
  `X-Permitted-Cross-Domain-Policies: none`. `Cache-Control: no-store` on authenticated responses.
- Rate limits (per IP; per user/key once authenticated): global 300/min; `/auth/*` 20/min with login and
  2FA at 10/min, forgot-password/register/resend at 5 per 15 min; `/public/*` 60/min; `/portal/*` 300/min;
  `/admin/*` 600/min. A route's own `config.rateLimit` wins.
- Body limit 1 MiB (`bodyLimit` in `app.ts`). Multipart routes must set their own `limits` from
  `getUploadPolicy()` (`storage.maxUploadMb`).
- Uploads (`lib/uploads.ts`, for tickets/invoices agents): `resolveStoragePath(root, ...segments)` rejects
  `..`, absolute segments, NUL and anything escaping the root (`400 invalid_path`); `sanitizeFilename`,
  `randomStorageName` (never use user names as path components), `assertUploadAllowed(policy, file)`
  (extension allow-list from `storage.allowedExtensions`, size → `413 payload_too_large`, blocks
  HTML/JS/SVG), `contentDisposition(filename)` for safe downloads, `ensureStorageDir`.
- Logging redacts `authorization` and `cookie` headers. Error envelope never includes stack traces.
- Secrets in env: `APP_KEY` (32 bytes hex) and `SESSION_SECRET` (≥32 chars); rotate `SESSION_SECRET` to
  invalidate all cookies, rotate `APP_KEY` only with a re-encryption migration.

## 7. Checklist for feature agents

1. Guard every `/admin/*` route with `requirePermission(...)` (or `requireStaff`), every `/portal/*` route
   with `requireClient` and a `clientId` filter.
2. Call `activityLog()` in every mutation with a small, secret-free diff (`entityDiff`).
3. Read settings through `getSettings(db, group)`; never return secret fields.
4. Files: only through `lib/uploads.ts` helpers; serve downloads with `contentDisposition()`.
5. Webhooks: verify signatures, use `security: []` in the schema, idempotent handlers.
6. Never interpolate user input into SQL; Drizzle query builder only.

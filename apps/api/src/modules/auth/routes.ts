import { totpSecrets, users } from '@provisia/db';
import type { AuthEmailData } from '@provisia/shared';
import { dataSchema } from '@provisia/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { createApiKey } from '../../lib/api-key.js';
import { requireAuth, requirePermission, requireSession } from '../../lib/auth.js';
import { type LockoutStatus, LoginLockout } from '../../lib/auth-lockout.js';
import { consumeToken, issueToken, peekToken } from '../../lib/auth-tokens.js';
import { loadAuthUser } from '../../lib/auth-user.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { sendTemplateEmail } from '../../lib/mail.js';
import { getSettings } from '../../lib/settings.js';
import {
  currentTotpCode as _unused,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  otpauthQrDataUrl,
  otpauthUrl,
  verifyTotpCode,
} from '../../lib/totp.js';
import { clearSessionCookie, sessionTtlMs, setSessionCookie } from '../../plugins/auth.js';
import {
  acceptInviteRequestSchema,
  apiKeySchema,
  changeOwnPasswordRequestSchema,
  createApiKeySchema,
  createdApiKeySchema,
  forgotPasswordRequestSchema,
  idParamsSchema,
  impersonateRequestSchema,
  login2faRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  okSchema,
  registerRequestSchema,
  registerResponseSchema,
  resendVerificationSchema,
  resetPasswordRequestSchema,
  sessionSchema,
  tokenQuerySchema,
  tokenValiditySchema,
  totpCodeSchema,
  totpConfirmResponseSchema,
  totpDisableRequestSchema,
  totpSetupResponseSchema,
  totpStatusSchema,
  verifyEmailRequestSchema,
} from './schemas.js';
import {
  authenticate,
  completeLogin,
  createSession,
  destroySession,
  findUserByEmail,
  getSession,
  getTotpState,
  listOwnApiKeys,
  listSessions,
  markEmailVerified,
  registerClient,
  revokeApiKey,
  revokeOtherSessions,
  revokeOwnSession,
  setPassword,
  verifyCurrentPassword,
  verifySecondFactor,
} from './service.js';

void _unused;

const AUTH_LIMIT = { max: 10, timeWindow: '1 minute' };
const EMAIL_LIMIT = { max: 5, timeWindow: '15 minutes' };

function lockoutFor(
  app: FastifyInstance,
  security: Awaited<ReturnType<typeof getSettings<'security'>>>,
) {
  return new LoginLockout(
    app.redis,
    {
      accountAttempts: security.lockoutAccountAttempts,
      ipAttempts: security.lockoutIpAttempts,
      windowSeconds: security.lockoutWindowMinutes * 60,
      lockSeconds: security.lockoutDurationMinutes * 60,
    },
    (err) => app.log.warn({ err }, 'login lockout store unavailable; failing open'),
  );
}

function throwLocked(status: LockoutStatus): never {
  if (!status.locked) throw new Error('unreachable');
  throw new AppError(
    'too_many_attempts',
    status.scope === 'account'
      ? 'Too many failed attempts for this account, try again later'
      : 'Too many failed attempts from this address, try again later',
    429,
    { retryAfterSeconds: status.retryAfterSeconds, scope: status.scope },
  );
}

function emailUser(u: {
  email: string;
  firstName: string;
  lastName: string;
}): AuthEmailData['user'] {
  return { email: u.email, firstName: u.firstName, lastName: u.lastName };
}

async function startSession(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: Parameters<typeof setSessionCookie>[0],
  userId: string,
  rememberMe: boolean,
) {
  const security = await getSettings(app.db, 'security');
  const session = await createSession(app.db, {
    userId,
    ttlMs: sessionTtlMs(app, rememberMe, security.sessionTtlHours),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    rememberMe,
  });
  setSessionCookie(reply, session.id, rememberMe);
  return session;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- login / logout / me
  app.post(
    '/auth/login',
    {
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary:
          'Log in with email and password; sets the session cookie or returns a 2FA challenge',
        security: [],
        body: loginRequestSchema,
        response: { 200: loginResponseSchema },
      },
    },
    async (req, reply) => {
      const { email, password, rememberMe, totpCode } = req.body;
      const security = await getSettings(app.db, 'security');
      const lockout = lockoutFor(app, security);
      const pre = await lockout.check(req.ip, email);
      if (pre.locked) throwLocked(pre);

      let auth: Awaited<ReturnType<typeof authenticate>>;
      try {
        auth = await authenticate(app.db, email, password);
      } catch (err) {
        const after = await lockout.fail(req.ip, email);
        if (after.locked) throwLocked(after);
        throw err;
      }

      if (security.requireEmailVerification && auth.role === 'client' && !auth.emailVerifiedAt) {
        throw new AppError('email_not_verified', 'Please verify your email address first', 403);
      }

      const totp = await getTotpState(app.db, auth.userId);
      if (totp?.enabled) {
        if (!totpCode) {
          const challenge = await issueToken(app.db, {
            userId: auth.userId,
            type: 'totp_challenge',
            meta: { rememberMe, ip: req.ip },
            keepExisting: true,
          });
          return {
            data: null,
            twoFactor: { challengeToken: challenge.token, expiresAt: challenge.expiresAt },
          };
        }
        if (!(await verifySecondFactor(app.db, auth.userId, totpCode))) {
          const after = await lockout.fail(req.ip, email);
          if (after.locked) throwLocked(after);
          throw new AppError('invalid_totp_code', 'Invalid two-factor code', 401);
        }
      }

      await lockout.succeed(req.ip, email);
      const user = await completeLogin(app.db, auth.userId);
      const session = await startSession(app, req, reply, user.id, rememberMe);
      req.auth = { user, via: 'session', sessionId: session.id };
      await activityLog(req, { action: 'auth.login', entityType: 'user', entityId: user.id });
      return { data: user };
    },
  );

  app.post(
    '/auth/login/2fa',
    {
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Complete a login with a TOTP or backup code',
        security: [],
        body: login2faRequestSchema,
        response: { 200: meResponseSchema },
      },
    },
    async (req, reply) => {
      const pending = await peekToken(app.db, 'totp_challenge', req.body.challengeToken);
      if (!pending)
        throw new AppError('invalid_token', 'Login challenge expired, sign in again', 401);
      const [u] = await app.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, pending.userId))
        .limit(1);
      const email = u?.email ?? pending.userId;
      const security = await getSettings(app.db, 'security');
      const lockout = lockoutFor(app, security);
      const pre = await lockout.check(req.ip, email);
      if (pre.locked) throwLocked(pre);

      if (!(await verifySecondFactor(app.db, pending.userId, req.body.code))) {
        const after = await lockout.fail(req.ip, email);
        if (after.locked) throwLocked(after);
        throw new AppError('invalid_totp_code', 'Invalid two-factor code', 401);
      }
      const consumed = await consumeToken(app.db, 'totp_challenge', req.body.challengeToken);
      if (!consumed)
        throw new AppError('invalid_token', 'Login challenge expired, sign in again', 401);

      await lockout.succeed(req.ip, email);
      const rememberMe = Boolean(consumed.meta?.rememberMe);
      const user = await completeLogin(app.db, consumed.userId);
      const session = await startSession(app, req, reply, user.id, rememberMe);
      req.auth = { user, via: 'session', sessionId: session.id };
      await activityLog(req, {
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        diff: { twoFactor: true },
      });
      return { data: user };
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Destroy the current session',
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (req.auth?.sessionId) {
        await destroySession(app.db, req.auth.sessionId);
        await activityLog(req, {
          action: 'auth.logout',
          entityType: 'user',
          entityId: req.auth.user.id,
        });
      }
      clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: requireAuth,
      schema: { tags: ['auth'], summary: 'Current user', response: { 200: meResponseSchema } },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      return { data: req.auth.user };
    },
  );

  // ---------------------------------------------------------------- registration + verification
  app.post(
    '/auth/register',
    {
      config: { rateLimit: EMAIL_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Client self-registration (creates user + client)',
        security: [],
        body: registerRequestSchema,
        response: { 201: registerResponseSchema },
      },
    },
    async (req, reply) => {
      const [security, localization] = await Promise.all([
        getSettings(app.db, 'security'),
        getSettings(app.db, 'localization'),
      ]);
      if (!security.allowRegistration) {
        throw new AppError('registration_disabled', 'Registration is disabled', 403);
      }
      const { userId, clientId } = await registerClient(app.db, req.body, {
        defaultCurrency: localization.defaultCurrency,
        emailVerified: !security.requireEmailVerification,
      });
      const user = await loadAuthUser(app.db, userId);
      if (!user) throw new Error('registered user not found');

      let actionUrl = `${app.config.WEB_URL}/portal`;
      if (security.requireEmailVerification) {
        const t = await issueToken(app.db, { userId, type: 'email_verify' });
        actionUrl = `${app.config.WEB_URL}/verify-email?token=${encodeURIComponent(t.token)}`;
      } else {
        const session = await startSession(app, req, reply, userId, false);
        req.auth = { user, via: 'session', sessionId: session.id };
      }
      await sendTemplateEmail('auth.welcome', {
        to: user.email,
        toUserId: user.id,
        toName: `${user.firstName} ${user.lastName}`.trim(),
        locale: req.body.language,
        data: { user: emailUser(user), actionUrl, expiresIn: '24 hours' },
        related: { type: 'client', id: clientId },
      }).catch((err) => req.log.error({ err }, 'failed to enqueue welcome email'));
      await activityLog(req, {
        action: 'auth.register',
        entityType: 'client',
        entityId: clientId,
        diff: { userId, email: user.email, country: req.body.country },
      });
      return reply
        .status(201)
        .send({ data: user, verificationRequired: security.requireEmailVerification });
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Confirm an email address with the token from the welcome mail',
        security: [],
        body: verifyEmailRequestSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      const t = await consumeToken(app.db, 'email_verify', req.body.token);
      if (!t)
        throw new AppError('invalid_token', 'This verification link is invalid or expired', 400);
      await markEmailVerified(app.db, t.userId);
      await activityLog(req, {
        action: 'auth.email_verified',
        entityType: 'user',
        entityId: t.userId,
      });
      return { data: { ok: true as const } };
    },
  );

  app.post(
    '/auth/resend-verification',
    {
      config: { rateLimit: EMAIL_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Send a new verification email (always 204)',
        security: [],
        body: resendVerificationSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const user = await findUserByEmail(app.db, req.body.email);
      if (user?.active && !user.emailVerifiedAt) {
        const t = await issueToken(app.db, { userId: user.id, type: 'email_verify' });
        await sendTemplateEmail('auth.welcome', {
          to: user.email,
          toUserId: user.id,
          data: {
            user: emailUser(user),
            actionUrl: `${app.config.WEB_URL}/verify-email?token=${encodeURIComponent(t.token)}`,
            expiresIn: '24 hours',
          },
        }).catch((err) => req.log.error({ err }, 'failed to enqueue verification email'));
      }
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- password reset / invite
  app.post(
    '/auth/forgot-password',
    {
      config: { rateLimit: EMAIL_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Send a password reset link (always 204, no account enumeration)',
        security: [],
        body: forgotPasswordRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const user = await findUserByEmail(app.db, req.body.email);
      if (user?.active) {
        const security = await getSettings(app.db, 'security');
        const ttlMs = security.passwordResetTtlMinutes * 60 * 1000;
        const t = await issueToken(app.db, { userId: user.id, type: 'password_reset', ttlMs });
        await sendTemplateEmail('auth.password_reset', {
          to: user.email,
          toUserId: user.id,
          data: {
            user: emailUser(user),
            actionUrl: `${app.config.WEB_URL}/reset-password?token=${encodeURIComponent(t.token)}`,
            expiresIn: `${security.passwordResetTtlMinutes} minutes`,
            ip: req.ip,
          },
        }).catch((err) => req.log.error({ err }, 'failed to enqueue password reset email'));
        await activityLog(req, {
          action: 'auth.password_reset_requested',
          entityType: 'user',
          entityId: user.id,
        });
      }
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/reset-password',
    {
      schema: {
        tags: ['auth'],
        summary: 'Check whether a reset/invite token is still valid',
        security: [],
        querystring: tokenQuerySchema.extend({
          type: z.enum(['reset', 'invite']).default('reset'),
        }),
        response: { 200: tokenValiditySchema },
      },
    },
    async (req) => {
      const t = await peekToken(
        app.db,
        req.query.type === 'invite' ? 'invite' : 'password_reset',
        req.query.token,
      );
      if (!t) return { data: { valid: false, email: null } };
      const [u] = await app.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, t.userId))
        .limit(1);
      return { data: { valid: true, email: u?.email ?? null } };
    },
  );

  app.post(
    '/auth/reset-password',
    {
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Set a new password with a reset token; revokes every session',
        security: [],
        body: resetPasswordRequestSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      const t = await consumeToken(app.db, 'password_reset', req.body.token);
      if (!t) throw new AppError('invalid_token', 'This reset link is invalid or expired', 400);
      await setPassword(app.db, t.userId, req.body.password, {
        revokeSessions: true,
        markVerified: true,
      });
      await activityLog(req, {
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: t.userId,
      });
      return { data: { ok: true as const } };
    },
  );

  app.post(
    '/auth/accept-invite',
    {
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Staff invite: choose the first password and log in',
        security: [],
        body: acceptInviteRequestSchema,
        response: { 200: meResponseSchema },
      },
    },
    async (req, reply) => {
      const t = await consumeToken(app.db, 'invite', req.body.token);
      if (!t) throw new AppError('invalid_token', 'This invitation is invalid or expired', 400);
      await setPassword(app.db, t.userId, req.body.password, {
        revokeSessions: true,
        markVerified: true,
      });
      await app.db.update(users).set({ active: true }).where(eq(users.id, t.userId));
      const user = await completeLogin(app.db, t.userId);
      const session = await startSession(app, req, reply, user.id, false);
      req.auth = { user, via: 'session', sessionId: session.id };
      await activityLog(req, {
        action: 'auth.invite_accepted',
        entityType: 'user',
        entityId: user.id,
      });
      return { data: user };
    },
  );

  app.post(
    '/auth/change-password',
    {
      preHandler: requireSession,
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Change own password (keeps the current session, revokes the others)',
        body: changeOwnPasswordRequestSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      if (req.auth.user.impersonator) throw forbidden('Not available while impersonating');
      if (!(await verifyCurrentPassword(app.db, req.auth.user.id, req.body.currentPassword))) {
        throw new AppError('invalid_credentials', 'Current password is incorrect', 401);
      }
      await setPassword(app.db, req.auth.user.id, req.body.newPassword, {
        revokeSessions: true,
        keepSessionId: req.auth.sessionId,
      });
      await activityLog(req, {
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: req.auth.user.id,
      });
      return { data: { ok: true as const } };
    },
  );

  // ---------------------------------------------------------------- sessions
  app.get(
    '/auth/sessions',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'List own active sessions',
        response: { 200: dataSchema(z.array(sessionSchema)) },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      return { data: await listSessions(app.db, req.auth.user.id, req.auth.sessionId) };
    },
  );

  app.delete(
    '/auth/sessions',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'Revoke every other session',
        response: { 200: dataSchema(z.object({ revoked: z.number().int() })) },
      },
    },
    async (req) => {
      if (!req.auth?.sessionId) throw unauthorized();
      const revoked = await revokeOtherSessions(app.db, req.auth.user.id, req.auth.sessionId);
      await activityLog(req, {
        action: 'auth.sessions_revoked',
        entityType: 'user',
        entityId: req.auth.user.id,
        diff: { revoked },
      });
      return { data: { revoked } };
    },
  );

  app.delete(
    '/auth/sessions/:id',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'Revoke one of own sessions',
        params: idParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      if (!(await revokeOwnSession(app.db, req.auth.user.id, req.params.id)))
        throw notFound('Session');
      await activityLog(req, {
        action: 'auth.session_revoked',
        entityType: 'session',
        entityId: req.params.id,
      });
      if (req.params.id === req.auth.sessionId) clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- TOTP 2FA
  app.get(
    '/auth/2fa',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: '2FA status',
        response: { 200: dataSchema(totpStatusSchema) },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const totp = await getTotpState(app.db, req.auth.user.id);
      return {
        data: {
          enabled: totp?.enabled ?? false,
          confirmedAt: totp?.confirmedAt ?? null,
          backupCodesRemaining: totp?.enabled ? totp.recoveryCodes.length : 0,
          required: req.auth.user.totpEnrollmentRequired,
        },
      };
    },
  );

  app.post(
    '/auth/2fa/setup',
    {
      preHandler: requireSession,
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Start TOTP enrolment: returns otpauth URL + QR (not enabled until confirmed)',
        response: { 200: totpSetupResponseSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      if (req.auth.user.impersonator) throw forbidden('Not available while impersonating');
      const existing = await getTotpState(app.db, req.auth.user.id);
      if (existing?.enabled)
        throw new AppError('totp_already_enabled', '2FA is already enabled', 409);
      const company = await getSettings(app.db, 'company');
      const secret = generateTotpSecret();
      await app.db
        .insert(totpSecrets)
        .values({
          userId: req.auth.user.id,
          secretEncrypted: encryptTotpSecret(secret),
          enabled: false,
        })
        .onConflictDoUpdate({
          target: totpSecrets.userId,
          set: {
            secretEncrypted: encryptTotpSecret(secret),
            enabled: false,
            recoveryCodes: [],
            confirmedAt: null,
          },
        });
      const url = otpauthUrl(secret, req.auth.user.email, company.name || 'Provisia');
      return { data: { otpauthUrl: url, qrDataUrl: await otpauthQrDataUrl(url), secret } };
    },
  );

  app.post(
    '/auth/2fa/confirm',
    {
      preHandler: requireSession,
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Confirm enrolment with a code; returns the backup codes once',
        body: totpCodeSchema,
        response: { 200: totpConfirmResponseSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const totp = await getTotpState(app.db, req.auth.user.id);
      if (!totp) throw badRequest('Start 2FA setup first');
      if (totp.enabled) throw new AppError('totp_already_enabled', '2FA is already enabled', 409);
      if (!verifyTotpCode(decryptTotpSecret(totp.secretEncrypted), req.body.code)) {
        throw new AppError('invalid_totp_code', 'Invalid two-factor code', 400);
      }
      const codes = generateBackupCodes();
      await app.db
        .update(totpSecrets)
        .set({ enabled: true, confirmedAt: new Date(), recoveryCodes: codes.map(hashBackupCode) })
        .where(eq(totpSecrets.userId, req.auth.user.id));
      await activityLog(req, {
        action: 'auth.2fa_enabled',
        entityType: 'user',
        entityId: req.auth.user.id,
      });
      await sendTemplateEmail('auth.2fa_enabled', {
        to: req.auth.user.email,
        toUserId: req.auth.user.id,
        data: {
          user: emailUser(req.auth.user),
          actionUrl: `${app.config.WEB_URL}/portal/account/security`,
          ip: req.ip,
        },
      }).catch((err) => req.log.error({ err }, 'failed to enqueue 2fa email'));
      return { data: { backupCodes: codes } };
    },
  );

  app.post(
    '/auth/2fa/backup-codes',
    {
      preHandler: requireSession,
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Regenerate backup codes (requires a current TOTP code)',
        body: totpCodeSchema,
        response: { 200: totpConfirmResponseSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      const totp = await getTotpState(app.db, req.auth.user.id);
      if (!totp?.enabled) throw badRequest('2FA is not enabled');
      if (!verifyTotpCode(decryptTotpSecret(totp.secretEncrypted), req.body.code)) {
        throw new AppError('invalid_totp_code', 'Invalid two-factor code', 400);
      }
      const codes = generateBackupCodes();
      await app.db
        .update(totpSecrets)
        .set({ recoveryCodes: codes.map(hashBackupCode) })
        .where(eq(totpSecrets.userId, req.auth.user.id));
      await activityLog(req, {
        action: 'auth.2fa_backup_codes_regenerated',
        entityType: 'user',
        entityId: req.auth.user.id,
      });
      return { data: { backupCodes: codes } };
    },
  );

  app.post(
    '/auth/2fa/disable',
    {
      preHandler: requireSession,
      config: { rateLimit: AUTH_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Disable 2FA (password + current code or backup code)',
        body: totpDisableRequestSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      if (req.auth.user.impersonator) throw forbidden('Not available while impersonating');
      if (!(await verifyCurrentPassword(app.db, req.auth.user.id, req.body.password))) {
        throw new AppError('invalid_credentials', 'Password is incorrect', 401);
      }
      if (!(await verifySecondFactor(app.db, req.auth.user.id, req.body.code))) {
        throw new AppError('invalid_totp_code', 'Invalid two-factor code', 400);
      }
      await app.db.delete(totpSecrets).where(eq(totpSecrets.userId, req.auth.user.id));
      await activityLog(req, {
        action: 'auth.2fa_disabled',
        entityType: 'user',
        entityId: req.auth.user.id,
      });
      return { data: { ok: true as const } };
    },
  );

  // ---------------------------------------------------------------- own API keys
  app.get(
    '/auth/api-keys',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'List own API keys',
        response: { 200: dataSchema(z.array(apiKeySchema)) },
      },
    },
    async (req) => {
      if (!req.auth) throw unauthorized();
      return { data: await listOwnApiKeys(app.db, req.auth.user.id) };
    },
  );

  app.post(
    '/auth/api-keys',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'Create an API key for the current user (token shown once)',
        body: createApiKeySchema,
        response: { 201: dataSchema(createdApiKeySchema) },
      },
    },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      if (req.auth.user.impersonator) throw forbidden('Not available while impersonating');
      const created = await createApiKey(app.db, {
        userId: req.auth.user.id,
        name: req.body.name,
        scopes: req.body.scopes,
        expiresAt: req.body.expiresAt ?? null,
      });
      const [row] = (await listOwnApiKeys(app.db, req.auth.user.id)).filter(
        (k) => k.id === created.id,
      );
      if (!row) throw new Error('api key not found after insert');
      await activityLog(req, {
        action: 'api_key.create',
        entityType: 'api_key',
        entityId: created.id,
        diff: { name: req.body.name, scopes: req.body.scopes },
      });
      return reply.status(201).send({ data: { ...row, token: created.token } });
    },
  );

  app.delete(
    '/auth/api-keys/:id',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'Revoke own API key',
        params: idParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      if (!(await revokeApiKey(app.db, req.params.id, req.auth.user.id))) throw notFound('API key');
      await activityLog(req, {
        action: 'api_key.revoke',
        entityType: 'api_key',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  // ---------------------------------------------------------------- impersonation
  app.post(
    '/auth/impersonate',
    {
      preHandler: [requireSession, requirePermission('clients.impersonate')],
      schema: {
        tags: ['auth'],
        summary: 'Log in as a client (admin session is restored by /auth/impersonate/stop)',
        body: impersonateRequestSchema,
        response: { 200: meResponseSchema },
      },
    },
    async (req, reply) => {
      if (!req.auth?.sessionId) throw unauthorized();
      if (req.auth.user.impersonator) throw forbidden('Already impersonating');
      const target = await loadAuthUser(app.db, req.body.userId, { requireActive: false });
      if (!target) throw notFound('User');
      if (target.role !== 'client') throw forbidden('Only client accounts can be impersonated');
      const security = await getSettings(app.db, 'security');
      const session = await createSession(app.db, {
        userId: target.id,
        ttlMs: Math.min(sessionTtlMs(app, false, security.sessionTtlHours), 4 * 60 * 60 * 1000),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        rememberMe: false,
        impersonatorUserId: req.auth.user.id,
        parentSessionId: req.auth.sessionId,
      });
      await activityLog(req, {
        action: 'auth.impersonate.start',
        entityType: 'user',
        entityId: target.id,
        diff: { adminUserId: req.auth.user.id, clientId: target.clientId },
      });
      setSessionCookie(reply, session.id, false);
      const asTarget = await loadAuthUser(app.db, target.id, {
        requireActive: false,
        impersonatorUserId: req.auth.user.id,
      });
      return { data: asTarget ?? target };
    },
  );

  app.post(
    '/auth/impersonate/stop',
    {
      preHandler: requireSession,
      schema: {
        tags: ['auth'],
        summary: 'End impersonation and return to the admin session',
        response: { 200: meResponseSchema },
      },
    },
    async (req, reply) => {
      if (!req.auth?.sessionId) throw unauthorized();
      const current = await getSession(app.db, req.auth.sessionId);
      if (!current?.impersonatorUserId) throw badRequest('Not impersonating');
      await activityLog(req, {
        action: 'auth.impersonate.stop',
        entityType: 'user',
        entityId: current.userId,
        diff: { adminUserId: current.impersonatorUserId },
      });
      await destroySession(app.db, current.id);
      const parent = current.parentSessionId
        ? await getSession(app.db, current.parentSessionId)
        : null;
      if (!parent || parent.userId !== current.impersonatorUserId) {
        clearSessionCookie(reply);
        throw new AppError('session_expired', 'Admin session expired, sign in again', 401);
      }
      setSessionCookie(reply, parent.id, parent.rememberMe);
      const admin = await loadAuthUser(app.db, parent.userId);
      if (!admin) throw unauthorized();
      return { data: admin };
    },
  );
};

export default routes;

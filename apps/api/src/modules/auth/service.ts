import { apiKeys, clients, type Db, sessions, totpSecrets, users } from '@provisia/db';
import type { AuthUser, RegisterRequest, Session } from '@provisia/shared';
import { and, desc, eq, gt, isNull, lt, ne } from 'drizzle-orm';
import { loadAuthUser } from '../../lib/auth-user.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../../lib/password.js';
import {
  consumeBackupCode,
  decryptTotpSecret,
  looksLikeBackupCode,
  verifyTotpCode,
} from '../../lib/totp.js';

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('invalid_credentials', 'Invalid email or password', 401);
  }
}

/**
 * Verifies email + password. Always does a hash comparison to keep timing uniform.
 * Returns the user id only; the caller loads the full `AuthUser` once the 2FA step is complete.
 */
export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<{ userId: string; role: 'admin' | 'staff' | 'client'; emailVerifiedAt: Date | null }> {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      active: users.active,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  const hash = row?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(hash, password);
  if (!row || !ok || !row.active) throw new InvalidCredentialsError();

  if (passwordNeedsRehash(row.passwordHash)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, row.id));
  }
  return { userId: row.id, role: row.role, emailVerifiedAt: row.emailVerifiedAt };
}

/** Second factor: 6-digit TOTP or a backup code (consumed). Returns false when 2FA is not enabled. */
export async function getTotpState(db: Db, userId: string) {
  const [row] = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, userId)).limit(1);
  return row ?? null;
}

export async function verifySecondFactor(db: Db, userId: string, code: string): Promise<boolean> {
  const totp = await getTotpState(db, userId);
  if (!totp?.enabled) return false;
  if (looksLikeBackupCode(code)) {
    const remaining = consumeBackupCode(totp.recoveryCodes, code);
    if (!remaining) return false;
    await db
      .update(totpSecrets)
      .set({ recoveryCodes: remaining })
      .where(eq(totpSecrets.userId, userId));
    return true;
  }
  return verifyTotpCode(decryptTotpSecret(totp.secretEncrypted), code);
}

export async function completeLogin(db: Db, userId: string): Promise<AuthUser> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  const user = await loadAuthUser(db, userId);
  if (!user) throw new InvalidCredentialsError();
  return user;
}

export interface CreateSessionInput {
  userId: string;
  ttlMs: number;
  ip?: string;
  userAgent?: string;
  rememberMe?: boolean;
  impersonatorUserId?: string | null;
  parentSessionId?: string | null;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      rememberMe: input.rememberMe ?? false,
      impersonatorUserId: input.impersonatorUserId ?? null,
      parentSessionId: input.parentSessionId ?? null,
      lastSeenAt: new Date(),
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('failed to create session');
  return { id: row.id, expiresAt };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function getSession(db: Db, sessionId: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function listSessions(db: Db, userId: string, currentId?: string): Promise<Session[]> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    ip: r.ip,
    userAgent: r.userAgent,
    rememberMe: r.rememberMe,
    impersonated: r.impersonatorUserId !== null,
    current: r.id === currentId,
    lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

/** Deletes one of the user's own sessions; returns false when it is not theirs. */
export async function revokeOwnSession(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function revokeOtherSessions(db: Db, userId: string, keepId: string): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Housekeeping for the maintenance queue. */
export async function deleteExpiredSessions(db: Db): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(and(lt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Sets a new password, stamps `passwordChangedAt` and (optionally) revokes every other session. */
export async function setPassword(
  db: Db,
  userId: string,
  password: string,
  opts: { revokeSessions?: boolean; keepSessionId?: string; markVerified?: boolean } = {},
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        passwordChangedAt: now,
        ...(opts.markVerified ? { emailVerifiedAt: now } : {}),
      })
      .where(eq(users.id, userId));
    if (opts.revokeSessions) {
      await tx
        .delete(sessions)
        .where(
          opts.keepSessionId
            ? and(eq(sessions.userId, userId), ne(sessions.id, opts.keepSessionId))
            : eq(sessions.userId, userId),
        );
    }
  });
}

export async function verifyCurrentPassword(db: Db, userId: string, password: string) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return false;
  return verifyPassword(row.passwordHash, password);
}

export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      active: users.active,
      firstName: users.firstName,
      lastName: users.lastName,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function markEmailVerified(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export class EmailTakenError extends AppError {
  constructor() {
    super('email_taken', 'An account with this email already exists', 409);
  }
}

/** Self-registration: user (role client) + client record in one transaction. */
export async function registerClient(
  db: Db,
  input: RegisterRequest,
  opts: { defaultCurrency: string; emailVerified: boolean },
): Promise<{ userId: string; clientId: string }> {
  const existing = await findUserByEmail(db, input.email);
  if (existing) throw new EmailTakenError();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        role: 'client',
        firstName: input.firstName,
        lastName: input.lastName,
        emailVerifiedAt: opts.emailVerified ? new Date() : null,
      })
      .returning({ id: users.id });
    if (!user) throw new Error('failed to create user');
    const [client] = await tx
      .insert(clients)
      .values({
        userId: user.id,
        companyName: input.companyName ?? null,
        vatNumber: input.vatNumber ? input.vatNumber.replace(/[\s.-]/g, '').toUpperCase() : null,
        address1: input.address1,
        address2: input.address2 ?? null,
        city: input.city,
        postalCode: input.postalCode,
        state: input.state ?? null,
        country: input.country,
        phone: input.phone ?? null,
        language: input.language,
        currency: opts.defaultCurrency,
      })
      .returning({ id: clients.id });
    if (!client) throw new Error('failed to create client');
    return { userId: user.id, clientId: client.id };
  });
}

/** Own API keys (not revoked). */
export async function listOwnApiKeys(db: Db, userId: string) {
  return db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      lastUsedIp: apiKeys.lastUsedIp,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: Db, keyId: string, userId?: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      userId
        ? and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))
        : and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)),
    )
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

// Hash of a random value so unknown emails cost the same as wrong passwords (timing).
const DUMMY_HASH = await hashPassword(crypto.randomUUID());

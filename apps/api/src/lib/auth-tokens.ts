import { createHash, randomBytes } from 'node:crypto';
import { authTokens, type Db } from '@provisia/db';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';

export type AuthTokenType = 'email_verify' | 'password_reset' | 'invite' | 'totp_challenge';

export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
  totp_challenge: 5 * 60 * 1000,
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, base64url (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Issues a single-use token. Previous unused tokens of the same type for the user are invalidated so
 * only the latest email link works. Returns the plaintext (never stored).
 */
export async function issueToken(
  db: Db,
  input: {
    userId: string;
    type: AuthTokenType;
    ttlMs?: number;
    meta?: Record<string, unknown>;
    /** Keep earlier tokens valid (used for TOTP challenges so parallel logins do not interfere). */
    keepExisting?: boolean;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? TOKEN_TTL_MS[input.type]));
  await db.transaction(async (tx) => {
    if (!input.keepExisting) {
      await tx
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(authTokens.userId, input.userId),
            eq(authTokens.type, input.type),
            isNull(authTokens.usedAt),
          ),
        );
    }
    await tx.insert(authTokens).values({
      userId: input.userId,
      type: input.type,
      tokenHash: hashToken(token),
      meta: input.meta ?? null,
      expiresAt,
    });
  });
  return { token, expiresAt };
}

export interface TokenRow {
  id: string;
  userId: string;
  type: AuthTokenType;
  meta: Record<string, unknown> | null;
  expiresAt: Date;
}

/** Looks a token up without consuming it (e.g. to show the reset form only for valid links). */
export async function peekToken(
  db: Db,
  type: AuthTokenType,
  token: string,
): Promise<TokenRow | null> {
  const [row] = await db
    .select({
      id: authTokens.id,
      userId: authTokens.userId,
      type: authTokens.type,
      meta: authTokens.meta,
      expiresAt: authTokens.expiresAt,
    })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Atomically marks a valid token as used and returns it; null when unknown, used or expired. */
export async function consumeToken(
  db: Db,
  type: AuthTokenType,
  token: string,
): Promise<TokenRow | null> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({
      id: authTokens.id,
      userId: authTokens.userId,
      type: authTokens.type,
      meta: authTokens.meta,
      expiresAt: authTokens.expiresAt,
    });
  return row ?? null;
}

/** True when the user has an outstanding (unused, unexpired) token of this type. */
export async function hasPendingToken(
  db: Db,
  userId: string,
  type: AuthTokenType,
): Promise<boolean> {
  const [row] = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Maintenance: removes expired or used tokens older than `olderThanMs`. */
export async function deleteStaleTokens(
  db: Db,
  olderThanMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, cutoff), lt(authTokens.usedAt, cutoff)))
    .returning({ id: authTokens.id });
  return rows.length;
}

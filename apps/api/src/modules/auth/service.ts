import { clients, type Db, sessions, users } from '@provisia/db';
import type { AuthUser } from '@provisia/shared';
import { and, eq, lt } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../../lib/password.js';

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('invalid_credentials', 'Invalid email or password', 401);
  }
}

/** Verifies email + password. Always does a hash comparison to keep timing uniform. */
export async function authenticate(db: Db, email: string, password: string): Promise<AuthUser> {
  const [row] = await db
    .select({ user: users, clientId: clients.id })
    .from(users)
    .leftJoin(clients, eq(clients.userId, users.id))
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  const hash = row?.user.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(hash, password);
  if (!row || !ok || !row.user.active) throw new InvalidCredentialsError();

  const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
  if (passwordNeedsRehash(row.user.passwordHash))
    updates.passwordHash = await hashPassword(password);
  await db.update(users).set(updates).where(eq(users.id, row.user.id));

  const { passwordHash: _omit, ...user } = row.user;
  return { ...user, clientId: row.clientId ?? null, lastLoginAt: updates.lastLoginAt ?? null };
}

export async function createSession(
  db: Db,
  input: { userId: string; ttlDays: number; ip?: string; userAgent?: string },
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('failed to create session');
  return { id: row.id, expiresAt };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Housekeeping for the maintenance queue. */
export async function deleteExpiredSessions(db: Db): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(and(lt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  return rows.length;
}

// Hash of a random value so unknown emails cost the same as wrong passwords (timing).
const DUMMY_HASH = await hashPassword(crypto.randomUUID());

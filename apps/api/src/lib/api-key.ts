import { createHash, randomBytes } from 'node:crypto';
import { apiKeys, type Db } from '@provisia/db';
import { and, eq, isNull } from 'drizzle-orm';

export const API_KEY_PREFIX = 'pv_';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Creates an API key for a user. Returns the plaintext token exactly once; only its sha256 is stored.
 */
export async function createApiKey(
  db: Db,
  input: { userId: string; name: string; expiresAt?: Date | null },
): Promise<{ id: string; token: string; prefix: string }> {
  const token = `${API_KEY_PREFIX}${randomToken(40)}`;
  const prefix = token.slice(0, 12);
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: input.userId,
      name: input.name,
      prefix,
      keyHash: hashApiKey(token),
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('failed to create api key');
  return { id: row.id, token, prefix };
}

/** Resolves a bearer token to its key row (not expired, not revoked), or null. */
export async function findApiKey(db: Db, token: string) {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashApiKey(token)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

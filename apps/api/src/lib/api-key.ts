import { createHash, randomBytes } from 'node:crypto';
import { apiKeys, type Db } from '@provisia/db';
import { and, eq, isNull } from 'drizzle-orm';

export const API_KEY_PREFIX = 'pv_';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(length: number): string {
  // Rejection sampling: 256 is not a multiple of 62, so plain modulo would bias the first characters.
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b < limit) out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Creates an API key for a user. Returns the plaintext token exactly once; only its sha256 is stored.
 * `scopes` are permission patterns (`clients.read`, `invoices.*`, `*`), always intersected with the
 * owner's permissions at request time.
 */
export async function createApiKey(
  db: Db,
  input: { userId: string; name: string; scopes?: string[]; expiresAt?: Date | null },
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
      scopes: input.scopes && input.scopes.length > 0 ? input.scopes : ['*'],
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

/** Throttled last-used tracking: at most one write per key per minute. */
const lastUsedWrites = new Map<string, number>();
export function touchApiKey(db: Db, keyId: string, ip: string, onError: (err: unknown) => void) {
  const now = Date.now();
  const prev = lastUsedWrites.get(keyId) ?? 0;
  if (now - prev < 60_000) return;
  lastUsedWrites.set(keyId, now);
  if (lastUsedWrites.size > 5000) lastUsedWrites.clear();
  db.update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip })
    .where(eq(apiKeys.id, keyId))
    .catch(onError);
}

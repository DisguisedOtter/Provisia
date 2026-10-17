import { clients, type Db, roles, totpSecrets, userRoles, users } from '@provisia/db';
import type { AuthUser, Impersonator } from '@provisia/shared';
import { and, eq } from 'drizzle-orm';
import { getSettings } from './settings.js';

/**
 * Builds the `AuthUser` DTO (what `/auth/me` returns and what the guards check):
 * user row minus the hash, client id, effective permissions, 2FA state and impersonator.
 */
export async function loadAuthUser(
  db: Db,
  userId: string,
  opts: { requireActive?: boolean; impersonatorUserId?: string | null } = {},
): Promise<AuthUser | null> {
  const [row] = await db
    .select({ user: users, clientId: clients.id, totpEnabled: totpSecrets.enabled })
    .from(users)
    .leftJoin(clients, eq(clients.userId, users.id))
    .leftJoin(totpSecrets, eq(totpSecrets.userId, users.id))
    .where(
      opts.requireActive === false
        ? eq(users.id, userId)
        : and(eq(users.id, userId), eq(users.active, true)),
    )
    .limit(1);
  if (!row) return null;

  const { passwordHash: _omit, passwordChangedAt: _omit2, ...user } = row.user;
  const permissions = await loadPermissions(db, user.id, user.role);
  const totpEnabled = row.totpEnabled === true;
  let totpEnrollmentRequired = false;
  if (user.role !== 'client' && !totpEnabled) {
    const security = await getSettings(db, 'security');
    totpEnrollmentRequired = security.require2faForStaff;
  }
  const impersonator = opts.impersonatorUserId
    ? await loadImpersonator(db, opts.impersonatorUserId)
    : null;

  return {
    ...user,
    clientId: row.clientId ?? null,
    permissions,
    totpEnabled,
    totpEnrollmentRequired,
    impersonator,
  };
}

/** `admin` → `['*']`, `staff` → union of role permissions, `client` → `[]`. */
export async function loadPermissions(
  db: Db,
  userId: string,
  role: 'admin' | 'staff' | 'client',
): Promise<string[]> {
  if (role === 'admin') return ['*'];
  if (role === 'client') return [];
  const rows = await db
    .select({ permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const set = new Set<string>();
  for (const r of rows) for (const p of r.permissions) set.add(p);
  return [...set].sort();
}

export async function loadImpersonator(db: Db, userId: string): Promise<Impersonator | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** Revokes every session of the given users (password reset, disable, role downgrade). */

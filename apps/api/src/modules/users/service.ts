import {
  apiKeys,
  authTokens,
  type Db,
  roles,
  sessions,
  totpSecrets,
  userRoles,
  users,
} from '@provisia/db';
import {
  type CreateStaffUser,
  DEFAULT_ROLES,
  hasAllPermissions,
  type InviteStaffUser,
  PERMISSIONS,
  type PermissionDescriptor,
  type Role,
  type StaffUser,
  type UpdateStaffUser,
} from '@provisia/shared';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  read: 'View',
  write: 'Create, edit and delete',
  manage: 'Full management',
  impersonate: 'Log in as',
};

export function listPermissions(): PermissionDescriptor[] {
  return PERMISSIONS.map((key) => {
    const [area = '', action = ''] = key.split('.');
    return {
      key,
      area,
      action,
      description: `${PERMISSION_DESCRIPTIONS[action] ?? action} ${area}`,
    };
  });
}

/** Idempotent: creates Admin/Support/Billing when missing. Called by the seed and at API boot. */
export async function ensureDefaultRoles(db: Db): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    await db
      .insert(roles)
      .values({
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: true,
      })
      .onConflictDoNothing({ target: roles.name });
  }
}

// ------------------------------------------------------------------ roles

async function roleUserCounts(db: Db, roleIds: string[]): Promise<Map<string, number>> {
  if (roleIds.length === 0) return new Map();
  const rows = await db
    .select({ roleId: userRoles.roleId, n: count() })
    .from(userRoles)
    .where(inArray(userRoles.roleId, roleIds))
    .groupBy(userRoles.roleId);
  return new Map(rows.map((r) => [r.roleId, Number(r.n)]));
}

export async function listRoles(db: Db): Promise<Role[]> {
  const rows = await db.select().from(roles).orderBy(asc(roles.name));
  const counts = await roleUserCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, userCount: counts.get(r.id) ?? 0 }));
}

export async function getRole(db: Db, id: string): Promise<Role> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!row) throw notFound('Role');
  const counts = await roleUserCounts(db, [id]);
  return { ...row, userCount: counts.get(id) ?? 0 };
}

/** The staff member performing a user/role mutation; admins have no ceiling, others cannot grant what they lack. */
export interface Actor {
  id: string;
  role: 'admin' | 'staff' | 'client';
  permissions: string[];
}

function assertCanGrantPermissions(actor: Actor, permissions: readonly string[]) {
  if (actor.role === 'admin') return;
  if (!hasAllPermissions(actor.permissions, permissions)) {
    throw forbidden('You can only grant permissions you hold yourself');
  }
}

async function assertCanAssignRoles(db: Db, actor: Actor, roleIds: readonly string[]) {
  if (actor.role === 'admin' || roleIds.length === 0) return;
  const rows = await db
    .select({ permissions: roles.permissions })
    .from(roles)
    .where(inArray(roles.id, [...roleIds]));
  for (const r of rows) assertCanGrantPermissions(actor, r.permissions);
}

function assertAdminTarget(actor: Actor, target: { role: string }, what: string) {
  if (target.role === 'admin' && actor.role !== 'admin') {
    throw forbidden(`Only administrators can ${what} an administrator account`);
  }
}

export async function createRole(
  db: Db,
  input: { name: string; description?: string | null; permissions: string[] },
  actor: Actor,
): Promise<Role> {
  assertCanGrantPermissions(actor, input.permissions);
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, input.name));
  if (existing) throw conflict('A role with this name already exists');
  const [row] = await db
    .insert(roles)
    .values({
      name: input.name,
      description: input.description ?? null,
      permissions: [...new Set(input.permissions)],
    })
    .returning();
  if (!row) throw new Error('failed to create role');
  return { ...row, userCount: 0 };
}

export async function updateRole(
  db: Db,
  id: string,
  input: { name?: string; description?: string | null; permissions?: string[] },
  actor: Actor,
): Promise<{ before: Role; after: Role }> {
  const before = await getRole(db, id);
  if (before.isSystem && before.permissions.includes('*')) {
    throw new AppError('role_is_system', 'The built-in Admin role cannot be changed', 409);
  }
  if (before.isSystem && actor.role !== 'admin') {
    throw forbidden('Only administrators can change system roles');
  }
  if (input.permissions) {
    // The actor must hold both what the role has now and what it is being given.
    assertCanGrantPermissions(actor, before.permissions);
    assertCanGrantPermissions(actor, input.permissions);
  }
  if (input.name && input.name !== before.name) {
    const [dup] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, input.name));
    if (dup) throw conflict('A role with this name already exists');
  }
  await db
    .update(roles)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.permissions !== undefined ? { permissions: [...new Set(input.permissions)] } : {}),
    })
    .where(eq(roles.id, id));
  return { before, after: await getRole(db, id) };
}

export async function deleteRole(db: Db, id: string): Promise<Role> {
  const role = await getRole(db, id);
  if (role.isSystem) throw new AppError('role_is_system', 'System roles cannot be deleted', 409);
  await db.delete(roles).where(eq(roles.id, id));
  return role;
}

// ------------------------------------------------------------------ staff users

async function attachRoles(db: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, Array<{ id: string; name: string }>>();
  const rows = await db
    .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, ids))
    .orderBy(asc(roles.name));
  const map = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.userId, list);
  }
  return map;
}

async function pendingInvites(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(
      and(
        inArray(authTokens.userId, ids),
        eq(authTokens.type, 'invite'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

async function toStaffUsers(
  db: Db,
  rows: Array<typeof users.$inferSelect & { totpEnabled: boolean | null }>,
) {
  const ids = rows.map((r) => r.id);
  const [roleMap, invites] = await Promise.all([attachRoles(db, ids), pendingInvites(db, ids)]);
  return rows.map(
    ({ passwordHash: _h, passwordChangedAt: _p, totpEnabled, ...u }): StaffUser => ({
      ...u,
      roles: roleMap.get(u.id) ?? [],
      totpEnabled: totpEnabled === true,
      invitePending: invites.has(u.id),
    }),
  );
}

export async function listStaff(
  db: Db,
  q: {
    page: number;
    perPage: number;
    search?: string;
    active?: 'true' | 'false';
    role?: 'admin' | 'staff';
  },
): Promise<{ data: StaffUser[]; total: number }> {
  const where = and(
    q.role ? eq(users.role, q.role) : inArray(users.role, ['admin', 'staff']),
    q.active ? eq(users.active, q.active === 'true') : undefined,
    q.search
      ? or(
          ilike(users.email, `%${q.search}%`),
          ilike(users.firstName, `%${q.search}%`),
          ilike(users.lastName, `%${q.search}%`),
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ user: users, totpEnabled: totpSecrets.enabled })
      .from(users)
      .leftJoin(totpSecrets, eq(totpSecrets.userId, users.id))
      .where(where)
      .orderBy(asc(users.lastName), asc(users.firstName))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage),
    db.select({ n: count() }).from(users).where(where),
  ]);
  return {
    data: await toStaffUsers(
      db,
      rows.map((r) => ({ ...r.user, totpEnabled: r.totpEnabled })),
    ),
    total: Number(total?.n ?? 0),
  };
}

export async function getStaff(db: Db, id: string): Promise<StaffUser> {
  const [row] = await db
    .select({ user: users, totpEnabled: totpSecrets.enabled })
    .from(users)
    .leftJoin(totpSecrets, eq(totpSecrets.userId, users.id))
    .where(and(eq(users.id, id), inArray(users.role, ['admin', 'staff'])))
    .limit(1);
  if (!row) throw notFound('User');
  const [u] = await toStaffUsers(db, [{ ...row.user, totpEnabled: row.totpEnabled }]);
  if (!u) throw notFound('User');
  return u;
}

async function assertRolesExist(db: Db, roleIds: string[]) {
  if (roleIds.length === 0) return;
  const rows = await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
  if (rows.length !== new Set(roleIds).size) throw notFound('Role');
}

type Executor = Pick<Db, 'delete' | 'insert'>;
async function setUserRoles(db: Executor, userId: string, roleIds: string[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await db.insert(userRoles).values([...new Set(roleIds)].map((roleId) => ({ userId, roleId })));
  }
}

export async function createStaff(
  db: Db,
  input: CreateStaffUser | (InviteStaffUser & { password: string }),
  actor: Actor,
  opts: { active?: boolean } = {},
): Promise<StaffUser> {
  if (input.role === 'admin' && actor.role !== 'admin') {
    throw forbidden('Only administrators can create administrator accounts');
  }
  await assertCanAssignRoles(db, actor, input.roleIds);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email));
  if (existing) throw conflict('A user with this email already exists');
  await assertRolesExist(db, input.roleIds);
  const passwordHash = await hashPassword(input.password);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
        active: opts.active ?? true,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    if (!row) throw new Error('failed to create user');
    if (input.roleIds.length > 0) {
      await tx
        .insert(userRoles)
        .values(input.roleIds.map((roleId) => ({ userId: row.id, roleId })));
    }
    return row.id;
  });
  return getStaff(db, id);
}

export async function updateStaff(
  db: Db,
  id: string,
  input: UpdateStaffUser,
  actor: Actor,
): Promise<{ before: StaffUser; after: StaffUser }> {
  const actorId = actor.id;
  const before = await getStaff(db, id);
  assertAdminTarget(actor, before, 'change');
  if (input.role === 'admin' && before.role !== 'admin' && actor.role !== 'admin') {
    throw forbidden('Only administrators can promote accounts to administrator');
  }
  if (input.roleIds) {
    await assertCanAssignRoles(db, actor, input.roleIds);
    if (actor.role !== 'admin') {
      // Removing roles the actor cannot grant would let them shape accounts above their own ceiling.
      const current = await db
        .select({ permissions: roles.permissions })
        .from(roles)
        .innerJoin(userRoles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, id));
      for (const r of current) assertCanGrantPermissions(actor, r.permissions);
    }
  }
  if (input.email && input.email !== before.email) {
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (dup) throw conflict('A user with this email already exists');
  }
  if (
    id === actorId &&
    (input.active === false || (input.role && input.role !== 'admin' && before.role === 'admin'))
  ) {
    throw new AppError('cannot_modify_self', 'You cannot disable or demote your own account', 409);
  }
  if (
    before.role === 'admin' &&
    (input.active === false || (input.role && input.role !== 'admin'))
  ) {
    await assertNotLastAdmin(db, id);
  }
  if (input.roleIds) await assertRolesExist(db, input.roleIds);
  await db.transaction(async (tx) => {
    const { roleIds, ...fields } = input;
    if (Object.keys(fields).length > 0) await tx.update(users).set(fields).where(eq(users.id, id));
    if (roleIds) await setUserRoles(tx, id, roleIds);
    if (input.active === false) await tx.delete(sessions).where(eq(sessions.userId, id));
  });
  return { before, after: await getStaff(db, id) };
}

export async function assertNotLastAdmin(db: Db, exceptId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptId)));
  if (Number(row?.n ?? 0) === 0) {
    throw new AppError('last_admin', 'At least one active admin must remain', 409);
  }
}

export async function setStaffActive(
  db: Db,
  id: string,
  active: boolean,
  actor: Actor,
): Promise<StaffUser> {
  const actorId = actor.id;
  const u = await getStaff(db, id);
  assertAdminTarget(actor, u, active ? 'enable' : 'disable');
  if (!active) {
    if (id === actorId)
      throw new AppError('cannot_modify_self', 'You cannot disable your own account', 409);
    if (u.role === 'admin') await assertNotLastAdmin(db, id);
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ active }).where(eq(users.id, id));
    if (!active) {
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.userId, id), isNull(apiKeys.revokedAt)));
    }
  });
  return getStaff(db, id);
}

/** Force 2FA reset: drops the secret so the user must enrol again on next login (if required). */
export async function resetTwoFactor(db: Db, id: string, actor: Actor): Promise<boolean> {
  const u = await getStaff(db, id);
  assertAdminTarget(actor, u, 'reset two-factor authentication of');
  const rows = await db
    .delete(totpSecrets)
    .where(eq(totpSecrets.userId, id))
    .returning({ id: totpSecrets.userId });
  await db.delete(sessions).where(eq(sessions.userId, id));
  return rows.length > 0;
}

// ------------------------------------------------------------------ all API keys (admin)

export async function listAllApiKeys(
  db: Db,
  q: { page: number; perPage: number; includeRevoked?: boolean },
) {
  const where = q.includeRevoked ? undefined : isNull(apiKeys.revokedAt);
  const [rows, [total]] = await Promise.all([
    db
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
        userEmail: users.email,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(where)
      .orderBy(desc(apiKeys.createdAt))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage),
    db.select({ n: count() }).from(apiKeys).where(where),
  ]);
  return { data: rows, total: Number(total?.n ?? 0) };
}

export const staffCountSql = sql<number>`count(*)`;

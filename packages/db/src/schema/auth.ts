import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';

export const userRoleEnum = pgEnum('user_role', ['admin', 'staff', 'client']);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('client'),
    firstName: varchar('first_name', { length: 100 }).notNull().default(''),
    lastName: varchar('last_name', { length: 100 }).notNull().default(''),
    active: boolean('active').notNull().default(true),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Bumped on password change/reset; sessions created before it are invalid. */
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    /** Persistent cookie (30 days) vs. browser-session cookie (1 day server side). */
    rememberMe: boolean('remember_me').notNull().default(false),
    /** Set on "login as client" sessions: the staff user who is impersonating `user_id`. */
    impersonatorUserId: uuid('impersonator_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** The impersonator's own session, restored when impersonation stops. */
    parentSessionId: uuid('parent_session_id'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    /** First 12 chars of the key (`pv_` + 9), shown in the UI to identify the key. */
    prefix: varchar('prefix', { length: 12 }).notNull(),
    /** sha256 hex of the full key; the plaintext is only shown once on creation. */
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    /**
     * Permission strings the key may exercise (`clients.read`, `invoices.write`, `clients.*`, `*`).
     * Always intersected with the owning user's permissions.
     */
    scopes: jsonb('scopes').$type<string[]>().notNull().default(['*']),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: varchar('last_used_ip', { length: 45 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.keyHash), index('api_keys_user_idx').on(t.userId)],
);

export const totpSecrets = pgTable('totp_secrets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** AES-256-GCM encrypted base32 secret. */
  secretEncrypted: text('secret_encrypted').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  /** sha256 hex hashes of unused backup codes (codes carry 50 bits of entropy; a KDF is not needed). */
  recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
  /** Last accepted TOTP time step (unix time / 30); a code is only ever accepted once. */
  lastUsedStep: integer('last_used_step'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'email_verify',
  'password_reset',
  'invite',
  'totp_challenge',
]);

/**
 * Single-use, expiring tokens handed out by email (verify, reset, invite) or kept server-side between the
 * password step and the TOTP step of a login (`totp_challenge`). Only the sha256 of the token is stored.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: authTokenTypeEnum('type').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** Small, type-specific context (e.g. `{ rememberMe, ip }` for a TOTP challenge). */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_idx').on(t.tokenHash),
    index('auth_tokens_user_type_idx').on(t.userId, t.type),
    index('auth_tokens_expires_idx').on(t.expiresAt),
  ],
);

/** Staff roles carrying permission strings (`clients.read`, `invoices.write`, `settings.manage`, `*`). */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    /** Seeded roles (Admin/Support/Billing) cannot be deleted; their permissions can be edited. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_name_idx').on(t.name)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('user_roles_role_idx').on(t.roleId)],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  apiKeys: many(apiKeys),
  totp: one(totpSecrets, { fields: [users.id], references: [totpSecrets.userId] }),
  userRoles: many(userRoles),
  authTokens: many(authTokens),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  impersonator: one(users, { fields: [sessions.impersonatorUserId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

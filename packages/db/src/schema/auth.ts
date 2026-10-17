import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
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
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
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
  /** argon2 hashes of unused recovery codes. */
  recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  apiKeys: many(apiKeys),
  totp: one(totpSecrets, { fields: [users.id], references: [totpSecrets.userId] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

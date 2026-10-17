import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';
import { users } from './auth.js';
import { services } from './services.js';

export const serverGroupFillTypeEnum = pgEnum('server_group_fill_type', [
  'least_loaded',
  'fill_first',
]);

/**
 * Named pools of servers. `servers.group_name` and `products.server_group` reference the group by
 * name (no FK) so that a product can be configured before its servers exist.
 */
export const serverGroups = pgTable('server_groups', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  fillType: serverGroupFillTypeEnum('fill_type').notNull().default('least_loaded'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const servers = pgTable(
  'servers',
  {
    id: id(),
    name: varchar('name', { length: 100 }).notNull(),
    /** Provisioner module id from the ModuleRegistry (e.g. `cpanel`, `proxmox`). */
    module: varchar('module', { length: 50 }).notNull(),
    hostname: varchar('hostname', { length: 255 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    port: integer('port'),
    secure: boolean('secure').notNull().default(true),
    /** AES-256-GCM encrypted JSON of credentials (username, password / api token, ...). */
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    nameservers: jsonb('nameservers').$type<string[]>().notNull().default([]),
    /** Servers in the same group are candidates for the same products. */
    groupName: varchar('group_name', { length: 100 }),
    maxAccounts: integer('max_accounts').notNull().default(0),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    /** Result of the last `testConnection` run. */
    statusCheckedAt: timestamp('status_checked_at', { withTimezone: true }),
    statusOk: boolean('status_ok'),
    statusMessage: text('status_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('servers_group_idx').on(t.groupName)],
);

export const provisioningLogStatusEnum = pgEnum('provisioning_log_status', ['success', 'failed']);

/** One row per provisioner call (worker side) or admin/portal provisioning request (API side). */
export const provisioningLog = pgTable(
  'provisioning_log',
  {
    id: id(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    serverId: uuid('server_id').references(() => servers.id, { onDelete: 'set null' }),
    /** `create`, `suspend`, `power:reboot`, `testConnection`, ... */
    action: varchar('action', { length: 50 }).notNull(),
    status: provisioningLogStatusEnum('status').notNull(),
    message: text('message'),
    /** Sanitised module response / error details; never credentials. */
    details: jsonb('details').$type<Record<string, unknown>>(),
    /** Null for worker/system actions. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    attempt: integer('attempt').notNull().default(1),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [
    index('provisioning_log_service_idx').on(t.serviceId, t.createdAt),
    index('provisioning_log_server_idx').on(t.serverId),
  ],
);

/** Latest synced resource usage per service (replaced on every `syncUsage`). */
export const serviceUsage = pgTable('service_usage', {
  serviceId: uuid('service_id')
    .primaryKey()
    .references(() => services.id, { onDelete: 'cascade' }),
  diskUsedMb: real('disk_used_mb'),
  diskLimitMb: real('disk_limit_mb'),
  bandwidthUsedMb: real('bandwidth_used_mb'),
  bandwidthLimitMb: real('bandwidth_limit_mb'),
  extra: jsonb('extra').$type<Record<string, number | string>>().notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const provisioningLogRelations = relations(provisioningLog, ({ one }) => ({
  service: one(services, { fields: [provisioningLog.serviceId], references: [services.id] }),
  server: one(servers, { fields: [provisioningLog.serverId], references: [servers.id] }),
}));

export const serviceUsageRelations = relations(serviceUsage, ({ one }) => ({
  service: one(services, { fields: [serviceUsage.serviceId], references: [services.id] }),
}));

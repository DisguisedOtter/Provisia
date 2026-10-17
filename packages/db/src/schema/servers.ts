import { boolean, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('servers_group_idx').on(t.groupName)],
);

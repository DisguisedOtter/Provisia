import { type Db, provisioningLog, serverGroups, servers, services } from '@provisia/db';
import { encryptJson, type ModuleRegistry, type Provisioner } from '@provisia/module-sdk';
import {
  type CreateServer,
  type CreateServerGroup,
  type Paginated,
  type PaginationQuery,
  type ProvisionerDescriptor,
  pageOffset,
  paginate,
  type ServerCapacity,
  type ServerGroup,
  type ServerGroupWithServers,
  type UpdateServer,
  type UpdateServerGroup,
} from '@provisia/shared';
import { and, asc, count, eq, getTableColumns, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { ServerListQuery } from './schemas.js';

type ServerRow = typeof servers.$inferSelect;

/* ------------------------------------------------------------------ modules */

export function describeProvisioner(mod: Provisioner): ProvisionerDescriptor {
  const toJson = (schema: z.ZodType | undefined) =>
    schema
      ? (z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>)
      : null;
  return {
    id: mod.id,
    name: mod.name,
    version: mod.version,
    configSchema: toJson(mod.configSchema) ?? {},
    credentialsSchema: toJson(mod.credentialsSchema),
    capabilities: {
      changePackage: Boolean(mod.changePackage),
      changePassword: Boolean(mod.changePassword),
      usage: Boolean(mod.getUsage),
      loginUrl: Boolean(mod.loginUrl),
      power: Boolean(mod.power),
      remoteOptions: Boolean(mod.listRemoteOptions),
    },
  };
}

export function listProvisioners(registry: ModuleRegistry): ProvisionerDescriptor[] {
  return registry.list('provisioner').map(describeProvisioner);
}

function requireProvisioner(registry: ModuleRegistry, id: string): Provisioner {
  const mod = registry.find('provisioner', id);
  if (!mod) throw badRequest(`Unknown provisioning module "${id}"`, { module: id });
  return mod;
}

/** Validates credentials against the module's schema (when it declares one) and encrypts them. */
function encryptCredentials(mod: Provisioner, credentials: Record<string, unknown>): string {
  if (mod.credentialsSchema) {
    const parsed = mod.credentialsSchema.safeParse(credentials);
    if (!parsed.success) {
      throw new AppError(
        'validation_error',
        'Invalid server credentials',
        400,
        parsed.error.issues,
      );
    }
    return encryptJson(parsed.data);
  }
  return encryptJson(credentials);
}

/* ------------------------------------------------------------------ servers */

const usedAccountsSql = sql<number>`(
  select count(*)::int from ${services}
  where ${services.serverId} = ${servers.id} and ${services.status} in ('pending', 'active', 'suspended')
)`;
const activeServicesSql = sql<number>`(
  select count(*)::int from ${services}
  where ${services.serverId} = ${servers.id} and ${services.status} = 'active'
)`;

function toCapacity(
  row: ServerRow & { usedAccounts: number; activeServices: number },
): ServerCapacity {
  const {
    credentialsEncrypted: _c,
    statusCheckedAt,
    statusOk,
    statusMessage,
    usedAccounts,
    activeServices,
    ...rest
  } = row;
  const free = rest.maxAccounts > 0 ? Math.max(0, rest.maxAccounts - usedAccounts) : null;
  return {
    ...rest,
    status: { checkedAt: statusCheckedAt, ok: statusOk, message: statusMessage },
    usedAccounts,
    activeServices,
    freeAccounts: free,
    full: rest.maxAccounts > 0 && usedAccounts >= rest.maxAccounts,
  };
}

async function selectServers(db: Db, where: SQL | undefined, q?: PaginationQuery) {
  let query = db
    .select({
      ...getTableColumns(servers),
      usedAccounts: usedAccountsSql,
      activeServices: activeServicesSql,
    })
    .from(servers)
    .where(where)
    .orderBy(asc(servers.name))
    .$dynamic();
  if (q) query = query.limit(q.perPage).offset(pageOffset(q));
  const rows = await query;
  return rows.map(toCapacity);
}

export async function listServers(db: Db, q: ServerListQuery): Promise<Paginated<ServerCapacity>> {
  const where = and(
    q.module ? eq(servers.module, q.module) : undefined,
    q.groupName ? eq(servers.groupName, q.groupName) : undefined,
    q.active !== undefined ? eq(servers.active, q.active) : undefined,
  );
  const [data, [{ total } = { total: 0 }]] = await Promise.all([
    selectServers(db, where, q),
    db.select({ total: count() }).from(servers).where(where),
  ]);
  return paginate(data, total, q);
}

export async function getServer(db: Db, id: string): Promise<ServerCapacity> {
  const [row] = await selectServers(db, eq(servers.id, id));
  if (!row) throw notFound('Server');
  return row;
}

export async function getServerRow(db: Db, id: string): Promise<ServerRow> {
  const [row] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  if (!row) throw notFound('Server');
  return row;
}

/**
 * Rejects hostnames that would point the panel client at the control plane itself (loopback,
 * link-local / cloud metadata, unspecified). Private RFC1918 ranges stay allowed: panels commonly
 * live on an internal network. Everything else (DNS names) is resolved by the module at call time.
 */
export function assertAllowedServerHostname(hostname: string): void {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const blocked =
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h === '::' ||
    h === '::1' ||
    h.startsWith('::ffff:127.') ||
    h.startsWith('::ffff:169.254.') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^fe[89ab][0-9a-f]:/.test(h) ||
    h === 'metadata.google.internal' ||
    h === 'metadata' ||
    h.endsWith('.internal');
  if (blocked) {
    throw badRequest('This hostname is not allowed for a provisioning server', { hostname });
  }
}

export async function createServer(
  db: Db,
  registry: ModuleRegistry,
  input: CreateServer,
): Promise<ServerCapacity> {
  const mod = requireProvisioner(registry, input.module);
  assertAllowedServerHostname(input.hostname);
  const { credentials, ...rest } = input;
  const [row] = await db
    .insert(servers)
    .values({ ...rest, credentialsEncrypted: encryptCredentials(mod, credentials) })
    .returning({ id: servers.id });
  if (!row) throw new AppError('internal_error', 'insert failed', 500);
  return getServer(db, row.id);
}

export async function updateServer(
  db: Db,
  registry: ModuleRegistry,
  id: string,
  input: UpdateServer,
): Promise<ServerCapacity> {
  const existing = await getServerRow(db, id);
  const moduleId = input.module ?? existing.module;
  const mod = requireProvisioner(registry, moduleId);
  if (input.module && input.module !== existing.module && !input.credentials) {
    throw badRequest('Changing the module requires new credentials');
  }
  if (input.hostname !== undefined) assertAllowedServerHostname(input.hostname);
  // Re-pointing an existing server (new host, or TLS switched off) would hand the stored API
  // credentials to whatever answers there on the next connection test. Require them to be re-entered.
  const endpointChanged =
    (input.hostname !== undefined && input.hostname !== existing.hostname) ||
    (input.secure === false && existing.secure);
  if (endpointChanged && !input.credentials) {
    throw badRequest(
      'Changing the hostname or disabling TLS requires re-entering the server credentials',
    );
  }
  const { credentials, ...rest } = input;
  await db
    .update(servers)
    .set({
      ...rest,
      ...(credentials ? { credentialsEncrypted: encryptCredentials(mod, credentials) } : {}),
      // Any change invalidates the last connection test result.
      ...(credentials || input.hostname || input.port !== undefined || input.secure !== undefined
        ? { statusCheckedAt: null, statusOk: null, statusMessage: null }
        : {}),
    })
    .where(eq(servers.id, id));
  return getServer(db, id);
}

export async function deleteServer(db: Db, id: string): Promise<void> {
  const server = await getServer(db, id);
  if (server.usedAccounts > 0) {
    throw conflict(
      `Server still has ${server.usedAccounts} services; move or terminate them first`,
    );
  }
  await db.delete(provisioningLog).where(eq(provisioningLog.serverId, id));
  await db.delete(servers).where(eq(servers.id, id));
}

/* ------------------------------------------------------------------ groups */

export async function listGroups(db: Db): Promise<ServerGroup[]> {
  return db.select().from(serverGroups).orderBy(asc(serverGroups.name));
}

export async function getGroup(db: Db, id: string): Promise<ServerGroup> {
  const [row] = await db.select().from(serverGroups).where(eq(serverGroups.id, id)).limit(1);
  if (!row) throw notFound('Server group');
  return row;
}

export async function createGroup(db: Db, input: CreateServerGroup): Promise<ServerGroup> {
  const [dup] = await db
    .select({ id: serverGroups.id })
    .from(serverGroups)
    .where(eq(serverGroups.name, input.name))
    .limit(1);
  if (dup) throw conflict(`Server group "${input.name}" already exists`);
  const [row] = await db.insert(serverGroups).values(input).returning();
  if (!row) throw new AppError('internal_error', 'insert failed', 500);
  return row;
}

/** Renaming a group re-points its servers (`servers.group_name`); products keep their own reference. */
export async function updateGroup(
  db: Db,
  id: string,
  input: UpdateServerGroup,
): Promise<ServerGroup> {
  const existing = await getGroup(db, id);
  if (input.name && input.name !== existing.name) {
    const [dup] = await db
      .select({ id: serverGroups.id })
      .from(serverGroups)
      .where(eq(serverGroups.name, input.name))
      .limit(1);
    if (dup) throw conflict(`Server group "${input.name}" already exists`);
    await db
      .update(servers)
      .set({ groupName: input.name })
      .where(eq(servers.groupName, existing.name));
  }
  await db.update(serverGroups).set(input).where(eq(serverGroups.id, id));
  return getGroup(db, id);
}

export async function deleteGroup(db: Db, id: string): Promise<void> {
  const existing = await getGroup(db, id);
  await db.update(servers).set({ groupName: null }).where(eq(servers.groupName, existing.name));
  await db.delete(serverGroups).where(eq(serverGroups.id, id));
}

export async function capacityOverview(
  db: Db,
): Promise<{ groups: ServerGroupWithServers[]; ungrouped: ServerCapacity[] }> {
  const [groups, all] = await Promise.all([listGroups(db), selectServers(db, undefined)]);
  const byGroup = new Map<string, ServerCapacity[]>();
  const ungrouped: ServerCapacity[] = [];
  for (const s of all) {
    if (!s.groupName) {
      ungrouped.push(s);
      continue;
    }
    const list = byGroup.get(s.groupName) ?? [];
    list.push(s);
    byGroup.set(s.groupName, list);
  }
  const out: ServerGroupWithServers[] = groups.map((g) => ({
    ...g,
    servers: byGroup.get(g.name) ?? [],
  }));
  // Groups referenced by servers but without a server_groups row (legacy / typed by hand) still show up.
  for (const [name, list] of byGroup) {
    if (!groups.some((g) => g.name === name)) {
      out.push({
        id: '00000000-0000-0000-0000-000000000000',
        name,
        description: 'implicit group (no server_groups row)',
        fillType: 'least_loaded',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        servers: list,
      });
    }
  }
  return { groups: out, ungrouped };
}

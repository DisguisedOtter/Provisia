import { randomBytes } from 'node:crypto';
import type { ViesClient } from '@provisia/core';
import { adjustCredit, BillingError, validateClientVat } from '@provisia/core/db';
import { clientContacts, clients, type Db, transactions, users } from '@provisia/db';
import {
  type ClientListQuery,
  type ClientWithUser,
  type CreateClient,
  type CreateClientContact,
  type Paginated,
  type PaginationQuery,
  pageOffset,
  paginate,
  type UpdateClient,
  type UpdateClientContact,
} from '@provisia/shared';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import type { UpdatePortalProfile } from './schemas.js';

export function mapBillingError(err: unknown): never {
  if (err instanceof BillingError)
    throw new AppError(err.code, err.message, err.status, err.details);
  throw err;
}

const DEFAULT_PERMISSIONS = {
  services: false,
  domains: false,
  invoices: false,
  tickets: true,
  profile: false,
};

function toClientWithUser(row: {
  client: typeof clients.$inferSelect;
  email: string;
  firstName: string;
  lastName: string;
}): ClientWithUser {
  return { ...row.client, email: row.email, firstName: row.firstName, lastName: row.lastName };
}

const selectWithUser = {
  client: clients,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
};

export async function listClients(db: Db, q: ClientListQuery): Promise<Paginated<ClientWithUser>> {
  const term = q.search?.trim();
  const where = and(
    q.status ? eq(clients.status, q.status) : undefined,
    q.country ? eq(clients.country, q.country) : undefined,
    term
      ? or(
          ilike(clients.companyName, `%${term}%`),
          ilike(users.email, `%${term}%`),
          ilike(users.firstName, `%${term}%`),
          ilike(users.lastName, `%${term}%`),
        )
      : undefined,
  );
  const rows = await db
    .select(selectWithUser)
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(where)
    .orderBy(desc(clients.createdAt))
    .limit(q.perPage)
    .offset(pageOffset(q));
  const [cnt] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(where);
  return paginate(rows.map(toClientWithUser), cnt?.n ?? 0, q);
}

export async function getClient(db: Db, id: string): Promise<ClientWithUser> {
  const [row] = await db
    .select(selectWithUser)
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, id))
    .limit(1);
  if (!row) throw notFound('Client');
  return toClientWithUser(row);
}

export async function createClient(
  db: Db,
  input: CreateClient,
): Promise<{ client: ClientWithUser; generatedPassword: string | null }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) throw new AppError('email_taken', 'A user with this email already exists', 409);
  const generated = input.password ? null : randomBytes(12).toString('base64url');
  const { email, password: _pw, firstName, lastName, ...clientFields } = input;
  const id = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email,
        passwordHash: await hashPassword(input.password ?? (generated as string)),
        role: 'client',
        firstName,
        lastName,
      })
      .returning({ id: users.id });
    if (!u) throw new Error('user insert failed');
    const [c] = await tx
      .insert(clients)
      .values({ userId: u.id, ...clientFields, vatNumber: clientFields.vatNumber?.trim() || null })
      .returning({ id: clients.id });
    if (!c) throw new Error('client insert failed');
    return c.id;
  });
  return { client: await getClient(db, id), generatedPassword: generated };
}

/** Changing the VAT number or country invalidates the cached VIES result. */
function vatReset(
  current: { vatNumber: string | null; country: string },
  patch: { vatNumber?: string | null; country?: string },
) {
  const nextVat =
    patch.vatNumber === undefined ? current.vatNumber : patch.vatNumber?.trim() || null;
  const nextCountry = patch.country ?? current.country;
  if (nextVat === current.vatNumber && nextCountry === current.country) return {};
  return { vatValidated: false, vatValidatedAt: null, vatCheckedAt: null, vatCheckResult: null };
}

export async function updateClient(
  db: Db,
  id: string,
  patch: UpdateClient,
): Promise<{ before: ClientWithUser; after: ClientWithUser }> {
  const before = await getClient(db, id);
  const { firstName, lastName, ...clientPatch } = patch;
  await db.transaction(async (tx) => {
    if (firstName !== undefined || lastName !== undefined) {
      await tx
        .update(users)
        .set({
          ...(firstName !== undefined ? { firstName } : {}),
          ...(lastName !== undefined ? { lastName } : {}),
        })
        .where(eq(users.id, before.userId));
    }
    if (Object.keys(clientPatch).length > 0) {
      await tx
        .update(clients)
        .set({
          ...clientPatch,
          ...(clientPatch.vatNumber !== undefined
            ? { vatNumber: clientPatch.vatNumber?.trim() || null }
            : {}),
          ...vatReset(before, clientPatch),
        })
        .where(eq(clients.id, id));
    }
  });
  return { before, after: await getClient(db, id) };
}

export async function updatePortalProfile(db: Db, clientId: string, patch: UpdatePortalProfile) {
  return updateClient(db, clientId, patch);
}

export async function closeClient(db: Db, id: string): Promise<ClientWithUser> {
  await getClient(db, id);
  await db.update(clients).set({ status: 'closed' }).where(eq(clients.id, id));
  return getClient(db, id);
}

// ---------------------------------------------------------------- contacts

export async function listContacts(db: Db, clientId: string) {
  await getClient(db, clientId);
  return db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(clientContacts.createdAt);
}

export async function createContact(db: Db, clientId: string, input: CreateClientContact) {
  await getClient(db, clientId);
  const [row] = await db
    .insert(clientContacts)
    .values({
      clientId,
      ...input,
      phone: input.phone ?? null,
      permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions ?? {}) },
    })
    .returning();
  if (!row) throw new Error('contact insert failed');
  return row;
}

async function getContact(db: Db, clientId: string, contactId: string) {
  const [row] = await db
    .select()
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .limit(1);
  if (!row) throw notFound('Contact');
  return row;
}

export async function updateContact(
  db: Db,
  clientId: string,
  contactId: string,
  patch: UpdateClientContact,
) {
  const existing = await getContact(db, clientId, contactId);
  const { permissions, ...rest } = patch;
  const [row] = await db
    .update(clientContacts)
    .set({
      ...rest,
      ...(permissions ? { permissions: { ...existing.permissions, ...permissions } } : {}),
    })
    .where(eq(clientContacts.id, contactId))
    .returning();
  if (!row) throw notFound('Contact');
  return row;
}

export async function deleteContact(db: Db, clientId: string, contactId: string) {
  await getContact(db, clientId, contactId);
  await db.delete(clientContacts).where(eq(clientContacts.id, contactId));
}

// ---------------------------------------------------------------- credit / transactions / VAT

export async function creditAdjustment(
  db: Db,
  clientId: string,
  input: { amount: number; description: string },
) {
  await getClient(db, clientId);
  return adjustCredit(db, clientId, input).catch(mapBillingError);
}

export async function listClientTransactions(db: Db, clientId: string, q: PaginationQuery) {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.clientId, clientId))
    .orderBy(desc(transactions.createdAt))
    .limit(q.perPage)
    .offset(pageOffset(q));
  const [cnt] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.clientId, clientId));
  return paginate(rows, cnt?.n ?? 0, q);
}

export async function validateVat(
  db: Db,
  clientId: string,
  vies: ViesClient,
  opts: { force: boolean; cacheDays: number },
) {
  await getClient(db, clientId);
  const r = await validateClientVat(db, clientId, vies, opts).catch(mapBillingError);
  return {
    valid: r.valid,
    countryCode: r.countryCode,
    vatNumber: r.vatNumber,
    name: r.name,
    address: r.address,
    requestIdentifier: r.requestIdentifier,
    checkedAt: r.checkedAt,
    unavailable: r.unavailable,
    cached: r.cached,
    reason: r.reason ?? null,
  };
}

export function conflictIf(cond: boolean, message: string): void {
  if (cond) throw conflict(message);
}

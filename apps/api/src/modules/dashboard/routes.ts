import { loadSettings } from '@provisia/core/db';
import {
  clients,
  domains,
  invoices,
  jobsLog,
  orders,
  products,
  services,
  tickets,
  transactions,
  users,
} from '@provisia/db';
import {
  dataSchema,
  orderListQuerySchema,
  orderWithItemsSchema,
  serviceWithProductSchema,
  ticketListItemSchema,
  ticketListQuerySchema,
} from '@provisia/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '../../lib/auth.js';
import { jobLogSchema } from '../automation/routes.js';
import { listOrders } from '../orders/service.js';
import { listTickets } from '../tickets/service.js';

const dashboardSchema = z.object({
  currency: z.string(),
  /** Payments received this calendar month (minus refunds), in minor units. */
  revenueThisMonth: z.number().int(),
  revenuePreviousMonth: z.number().int(),
  /** Sum of unpaid invoice totals. */
  outstanding: z.number().int(),
  /** Unpaid invoices past their due date. */
  overdue: z.number().int(),
  counts: z.object({
    clients: z.number().int(),
    activeServices: z.number().int(),
    openTickets: z.number().int(),
    pendingOrders: z.number().int(),
    unpaidInvoices: z.number().int(),
    overdueInvoices: z.number().int(),
    failedJobs: z.number().int(),
  }),
  recentOrders: z.array(orderWithItemsSchema),
  openTickets: z.array(ticketListItemSchema),
  servicesDue: z.array(serviceWithProductSchema),
  failedJobs: z.array(jobLogSchema.extend({ name: z.string() })),
});

const searchResultsSchema = z.object({
  clients: z.array(
    z.object({
      id: z.uuid(),
      companyName: z.string().nullable(),
      email: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    }),
  ),
  domains: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })),
  invoices: z.array(
    z.object({
      id: z.uuid(),
      number: z.string().nullable(),
      status: z.string(),
      total: z.number().int(),
      currency: z.string(),
    }),
  ),
  tickets: z.array(
    z.object({ id: z.uuid(), number: z.string(), subject: z.string(), status: z.string() }),
  ),
  services: z.array(z.object({ id: z.uuid(), domain: z.string().nullable(), status: z.string() })),
});

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Admin dashboard and global search. Both are read-only aggregations over the other modules' tables,
 * kept here so no feature module depends on another one.
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/dashboard',
    {
      preHandler: requirePermission('reports.read'),
      schema: {
        tags: ['dashboard'],
        summary: 'Key figures and attention lists for the admin dashboard',
        response: { 200: dataSchema(dashboardSchema) },
      },
    },
    async (req) => {
      const db = app.db;
      const now = new Date();
      const today = isoDate(now);
      const monthStart = startOfMonth(now);
      const prevMonthStart = startOfMonth(now, -1);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const dueSoon = isoDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
      const settings = await loadSettings(db);
      const currency = settings['billing.currency'];

      // Net payments: payments minus refunds, per month.
      const revenueExpr = sql<number>`coalesce(sum(case when ${transactions.type} = 'refund' then -${transactions.amount} else ${transactions.amount} end), 0)`;
      const unpaid = eq(invoices.status, 'unpaid');
      const overdueCond = and(unpaid, lt(invoices.dueDate, today));

      const [
        [revenueNow],
        [revenuePrev],
        [outstanding],
        [overdue],
        [clientCount],
        [activeServices],
        [openTickets],
        [pendingOrders],
        [failedJobCount],
        recentOrders,
        openTicketList,
        dueRows,
        failedRows,
      ] = await Promise.all([
        db
          .select({ v: revenueExpr })
          .from(transactions)
          .where(
            and(
              inArray(transactions.type, ['payment', 'refund']),
              gte(transactions.createdAt, monthStart),
            ),
          ),
        db
          .select({ v: revenueExpr })
          .from(transactions)
          .where(
            and(
              inArray(transactions.type, ['payment', 'refund']),
              gte(transactions.createdAt, prevMonthStart),
              lt(transactions.createdAt, monthStart),
            ),
          ),
        db
          .select({ v: sql<number>`coalesce(sum(${invoices.total}), 0)`, n: count() })
          .from(invoices)
          .where(unpaid),
        db
          .select({ v: sql<number>`coalesce(sum(${invoices.total}), 0)`, n: count() })
          .from(invoices)
          .where(overdueCond),
        db.select({ n: count() }).from(clients).where(eq(clients.status, 'active')),
        db.select({ n: count() }).from(services).where(eq(services.status, 'active')),
        db
          .select({ n: count() })
          .from(tickets)
          .where(inArray(tickets.status, ['open', 'customer_reply'])),
        db.select({ n: count() }).from(orders).where(eq(orders.status, 'pending')),
        db
          .select({ n: count() })
          .from(jobsLog)
          .where(and(eq(jobsLog.status, 'failed'), gte(jobsLog.startedAt, dayAgo))),
        listOrders(db, orderListQuerySchema.parse({ perPage: 5 })),
        listTickets(
          db,
          ticketListQuerySchema.parse({ status: 'open,customer_reply', perPage: 5 }),
          { internal: true, userId: req.auth?.user.id },
        ),
        db
          .select({ service: services, productName: products.name })
          .from(services)
          .leftJoin(products, eq(products.id, services.productId))
          .where(and(eq(services.status, 'active'), lte(services.nextDueDate, dueSoon)))
          .orderBy(asc(services.nextDueDate))
          .limit(5),
        db
          .select()
          .from(jobsLog)
          .where(and(eq(jobsLog.status, 'failed'), gte(jobsLog.startedAt, dayAgo)))
          .orderBy(desc(jobsLog.startedAt))
          .limit(5),
      ]);

      return {
        data: {
          currency,
          revenueThisMonth: num(revenueNow?.v),
          revenuePreviousMonth: num(revenuePrev?.v),
          outstanding: num(outstanding?.v),
          overdue: num(overdue?.v),
          counts: {
            clients: num(clientCount?.n),
            activeServices: num(activeServices?.n),
            openTickets: num(openTickets?.n),
            pendingOrders: num(pendingOrders?.n),
            unpaidInvoices: num(outstanding?.n),
            overdueInvoices: num(overdue?.n),
            failedJobs: num(failedJobCount?.n),
          },
          recentOrders: recentOrders.data,
          openTickets: openTicketList.data,
          servicesDue: dueRows.map(({ service, productName }) => {
            const { passwordEncrypted: _omit, ...rest } = service;
            return { ...rest, productName: productName ?? undefined };
          }),
          failedJobs: failedRows.map((r) => ({
            ...r,
            name: r.jobName,
            durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
          })),
        },
      };
    },
  );

  app.get(
    '/admin/search',
    {
      preHandler: requirePermission('reports.read'),
      schema: {
        tags: ['dashboard'],
        summary: 'Global search across clients, domains, invoices, tickets and services',
        querystring: z.object({ q: z.string().trim().min(1).max(100) }),
        response: { 200: dataSchema(searchResultsSchema) },
      },
    },
    async (req) => {
      const db = app.db;
      const term = `%${req.query.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const bare = req.query.q.replace(/^#/, '');
      const limit = 5;
      const [clientRows, domainRows, invoiceRows, ticketRows, serviceRows] = await Promise.all([
        db
          .select({
            id: clients.id,
            companyName: clients.companyName,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(clients)
          .innerJoin(users, eq(users.id, clients.userId))
          .where(
            or(
              ilike(clients.companyName, term),
              ilike(users.email, term),
              ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, term),
            ),
          )
          .orderBy(asc(clients.companyName))
          .limit(limit),
        db
          .select({ id: domains.id, name: domains.name, status: domains.status })
          .from(domains)
          .where(ilike(domains.name, term))
          .orderBy(asc(domains.name))
          .limit(limit),
        db
          .select({
            id: invoices.id,
            number: invoices.number,
            status: invoices.status,
            total: invoices.total,
            currency: invoices.currency,
          })
          .from(invoices)
          .where(ilike(invoices.number, term))
          .orderBy(desc(invoices.createdAt))
          .limit(limit),
        db
          .select({
            id: tickets.id,
            number: tickets.number,
            subject: tickets.subject,
            status: tickets.status,
          })
          .from(tickets)
          .where(or(ilike(tickets.subject, term), ilike(tickets.number, `%${bare}%`)))
          .orderBy(desc(tickets.createdAt))
          .limit(limit),
        db
          .select({ id: services.id, domain: services.domain, status: services.status })
          .from(services)
          .where(ilike(services.domain, term))
          .orderBy(asc(services.domain))
          .limit(limit),
      ]);
      return {
        data: {
          clients: clientRows,
          domains: domainRows,
          invoices: invoiceRows,
          tickets: ticketRows,
          services: serviceRows,
        },
      };
    },
  );
};

export default routes;

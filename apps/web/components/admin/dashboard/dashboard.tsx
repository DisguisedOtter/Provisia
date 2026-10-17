'use client';

import type { Order, Service, Ticket } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Clock,
  FileText,
  LifeBuoy,
  Plus,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi } from '@/lib/admin/api';
import { isMissingEndpoint } from '@/lib/admin/form-errors';
import { fmtDate, fmtRelative } from '@/lib/admin/format';
import { JOB_STATUS, ORDER_STATUS, SERVICE_STATUS, TICKET_STATUS } from '@/lib/admin/status';
import type { JobLogEntry } from '@/lib/admin/types';
import { type Column, SimpleTable } from '../data-table';
import { EmptyState } from '../empty-state';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatCard } from '../stat-card';
import { StatusBadge } from '../status-badge';

export function Dashboard() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => adminApi.dashboard.stats(),
    retry: false,
  });
  const d = q.data?.data;
  const missing = q.isError && isMissingEndpoint(q.error);

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="What needs your attention today."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/clients/new">
                <Plus /> Client
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/invoices/new">
                <Plus /> Invoice
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/tickets/new">
                <Plus /> Ticket
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/products">
                <Plus /> Product
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue this month"
          icon={TrendingUp}
          loading={q.isPending}
          value={d ? <Money amount={d.revenueThisMonth} currency={d.currency} /> : '—'}
          hint={
            d?.revenuePreviousMonth !== undefined ? (
              <>
                Previous month: <Money amount={d.revenuePreviousMonth} currency={d.currency} />
              </>
            ) : undefined
          }
          href="/admin/transactions"
        />
        <StatCard
          label="Outstanding"
          icon={Wallet}
          loading={q.isPending}
          value={d ? <Money amount={d.outstanding} currency={d.currency} /> : '—'}
          hint={d ? `${d.counts.unpaidInvoices} unpaid invoices` : undefined}
          href="/admin/invoices?status=unpaid"
          tone={d && d.outstanding > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Overdue"
          icon={AlertTriangle}
          loading={q.isPending}
          value={d ? <Money amount={d.overdue} currency={d.currency} /> : '—'}
          hint={d ? `${d.counts.overdueInvoices} overdue invoices` : undefined}
          href="/admin/invoices?status=unpaid&overdue=true"
          tone={d && d.overdue > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Open tickets"
          icon={LifeBuoy}
          loading={q.isPending}
          value={d ? d.counts.openTickets : '—'}
          hint={
            d
              ? `${d.counts.pendingOrders} pending orders · ${d.counts.activeServices} active services`
              : undefined
          }
          href="/admin/tickets?status=open"
        />
      </div>

      {missing ? (
        <div className="mt-6">
          <EmptyState
            icon={Boxes}
            title="Dashboard data is not available yet"
            description="GET /api/v1/admin/dashboard has not been implemented by the API. The widgets below will populate automatically once it exists."
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Recent orders" icon={ShoppingCart} href="/admin/orders">
          <QueryState isPending={q.isPending} error={missing ? null : q.error} compact>
            <OrdersMini rows={d?.recentOrders ?? []} />
          </QueryState>
        </Panel>
        <Panel title="Open tickets" icon={LifeBuoy} href="/admin/tickets">
          <QueryState isPending={q.isPending} error={missing ? null : q.error} compact>
            <TicketsMini rows={d?.openTickets ?? []} />
          </QueryState>
        </Panel>
        <Panel title="Services due soon" icon={Clock} href="/admin/services">
          <QueryState isPending={q.isPending} error={missing ? null : q.error} compact>
            <ServicesMini rows={d?.servicesDue ?? []} />
          </QueryState>
        </Panel>
        <Panel title="Failed jobs" icon={AlertTriangle} href="/admin/settings/automation">
          <QueryState isPending={q.isPending} error={missing ? null : q.error} compact>
            <JobsMini rows={d?.failedJobs ?? []} />
          </QueryState>
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Clients"
          icon={Users}
          loading={q.isPending}
          value={d?.counts.clients ?? '—'}
          href="/admin/clients"
        />
        <StatCard
          label="Active services"
          icon={Boxes}
          loading={q.isPending}
          value={d?.counts.activeServices ?? '—'}
          href="/admin/services?status=active"
        />
        <StatCard
          label="Pending orders"
          icon={FileText}
          loading={q.isPending}
          value={d?.counts.pendingOrders ?? '—'}
          href="/admin/orders?status=pending"
        />
      </div>
    </>
  );
}

function Panel({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={href}>View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

function OrdersMini({ rows }: { rows: Order[] }) {
  const cols: Column<Order>[] = [
    { id: 'number', header: 'Order', cell: (o) => `#${o.number}` },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => <StatusBadge value={o.status} map={ORDER_STATUS} />,
    },
    {
      id: 'total',
      header: 'Total',
      align: 'right',
      cell: (o) => <Money amount={o.total} currency={o.currency} />,
    },
    { id: 'created', header: 'Placed', hideBelow: 'sm', cell: (o) => fmtRelative(o.createdAt) },
  ];
  return (
    <SimpleTable
      columns={cols}
      rows={rows}
      rowKey={(o) => o.id}
      rowHref={(o) => `/admin/orders/${o.id}`}
      emptyTitle="No recent orders"
      dense
    />
  );
}

function TicketsMini({ rows }: { rows: Ticket[] }) {
  const cols: Column<Ticket>[] = [
    {
      id: 'subject',
      header: 'Ticket',
      cell: (t) => (
        <span className="line-clamp-1">
          #{t.number} {t.subject}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <StatusBadge value={t.status} map={TICKET_STATUS} />,
    },
    {
      id: 'last',
      header: 'Last reply',
      hideBelow: 'sm',
      cell: (t) => fmtRelative(t.lastReplyAt ?? t.createdAt),
    },
  ];
  return (
    <SimpleTable
      columns={cols}
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={(t) => `/admin/tickets/${t.id}`}
      emptyTitle="No open tickets"
      dense
    />
  );
}

function ServicesMini({ rows }: { rows: Service[] }) {
  const cols: Column<Service>[] = [
    { id: 'domain', header: 'Service', cell: (s) => s.domain ?? s.username ?? s.id.slice(0, 8) },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusBadge value={s.status} map={SERVICE_STATUS} />,
    },
    { id: 'due', header: 'Due', cell: (s) => fmtDate(s.nextDueDate) },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      hideBelow: 'sm',
      cell: (s) => <Money amount={s.recurringAmount} currency={s.currency} />,
    },
  ];
  return (
    <SimpleTable
      columns={cols}
      rows={rows}
      rowKey={(s) => s.id}
      rowHref={(s) => `/admin/services/${s.id}`}
      emptyTitle="Nothing due soon"
      dense
    />
  );
}

function JobsMini({ rows }: { rows: JobLogEntry[] }) {
  const cols: Column<JobLogEntry>[] = [
    {
      id: 'job',
      header: 'Job',
      cell: (j) => (
        <span className="font-mono text-xs">
          {j.queue}:{j.name}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (j) => <StatusBadge value={j.status} map={JOB_STATUS} />,
    },
    {
      id: 'error',
      header: 'Error',
      hideBelow: 'sm',
      cell: (j) => (
        <span className="line-clamp-1 max-w-64 text-muted-foreground text-xs">
          {j.error ?? '—'}
        </span>
      ),
    },
    { id: 'when', header: 'When', cell: (j) => fmtRelative(j.finishedAt ?? j.startedAt) },
  ];
  return (
    <SimpleTable
      columns={cols}
      rows={rows}
      rowKey={(j) => j.id}
      rowHref={() => '/admin/settings/automation'}
      emptyTitle="No failed jobs"
      emptyDescription="Automation is healthy."
      dense
    />
  );
}

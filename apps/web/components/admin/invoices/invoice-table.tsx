'use client';

import type { Invoice } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin/api';
import { fmtDate } from '@/lib/admin/format';
import { INVOICE_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { cn } from '@/lib/utils';
import { ClientCell } from '../client-cell';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { StatusBadge } from '../status-badge';

export function isOverdue(i: Invoice) {
  return i.status === 'unpaid' && i.dueDate !== null && new Date(i.dueDate) < new Date();
}

export function InvoiceTable({
  clientId,
  toolbar,
}: {
  clientId?: string;
  toolbar?: React.ReactNode;
}) {
  const { state, update, query } = useTableState(['status', 'overdue'], {
    sort: 'createdAt',
    order: 'desc',
  });
  const q = useQuery({
    queryKey: ['invoices', { ...query, clientId }],
    queryFn: () => adminApi.invoices.list({ ...query, clientId }),
    placeholderData: (p) => p,
  });
  const columns: Column<Invoice>[] = [
    {
      id: 'number',
      header: 'Invoice',
      sortKey: 'number',
      cell: (i) => i.number ?? <span className="text-muted-foreground italic">Draft</span>,
    },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            header: 'Client',
            hideBelow: 'md',
            cell: (i: Invoice) => <ClientCell id={i.clientId} />,
          } as Column<Invoice>,
        ]),
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (i) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge value={i.status} map={INVOICE_STATUS} />
          {isOverdue(i) ? (
            <span className="text-red-600 text-xs dark:text-red-400">overdue</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'issue',
      header: 'Issued',
      sortKey: 'issueDate',
      hideBelow: 'lg',
      cell: (i) => fmtDate(i.issueDate),
    },
    {
      id: 'due',
      header: 'Due',
      sortKey: 'dueDate',
      hideBelow: 'sm',
      cell: (i) => (
        <span className={cn(isOverdue(i) && 'text-red-600 dark:text-red-400')}>
          {fmtDate(i.dueDate)}
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      sortKey: 'total',
      align: 'right',
      cell: (i) => <Money amount={i.total} currency={i.currency} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(i) => i.id}
      rowHref={(i) => `/admin/invoices/${i.id}`}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Invoice number…"
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: Object.entries(INVOICE_STATUS).map(([value, v]) => ({ value, label: v.label })),
        },
      ]}
      toolbar={toolbar}
      emptyTitle="No invoices"
      emptyDescription={
        clientId
          ? 'This client has no invoices yet.'
          : 'Invoices are generated from services or created manually.'
      }
    />
  );
}

'use client';

import type { Order } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin/api';
import { fmtDateTime } from '@/lib/admin/format';
import { ORDER_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { ClientCell } from '../client-cell';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { StatusBadge } from '../status-badge';

export function OrderTable({ clientId }: { clientId?: string }) {
  const { state, update, query } = useTableState(['status'], { sort: 'createdAt', order: 'desc' });
  const q = useQuery({
    queryKey: ['orders', { ...query, clientId }],
    queryFn: () => adminApi.orders.list({ ...query, clientId }),
    placeholderData: (p) => p,
  });
  const columns: Column<Order>[] = [
    { id: 'number', header: 'Order', sortKey: 'number', cell: (o) => `#${o.number}` },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            header: 'Client',
            hideBelow: 'md',
            cell: (o: Order) => <ClientCell id={o.clientId} />,
          } as Column<Order>,
        ]),
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (o) => <StatusBadge value={o.status} map={ORDER_STATUS} />,
    },
    {
      id: 'total',
      header: 'Total',
      sortKey: 'total',
      align: 'right',
      cell: (o) => <Money amount={o.total} currency={o.currency} />,
    },
    {
      id: 'invoice',
      header: 'Invoice',
      hideBelow: 'lg',
      cell: (o) => (o.invoiceId ? 'Linked' : <span className="text-muted-foreground">—</span>),
    },
    {
      id: 'created',
      header: 'Placed',
      sortKey: 'createdAt',
      hideBelow: 'sm',
      cell: (o) => fmtDateTime(o.createdAt),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(o) => o.id}
      rowHref={(o) => `/admin/orders/${o.id}`}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Order number…"
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: Object.entries(ORDER_STATUS).map(([value, v]) => ({ value, label: v.label })),
        },
      ]}
      emptyTitle="No orders"
      emptyDescription={
        clientId
          ? 'This client has not placed any orders.'
          : 'Orders placed in the portal show up here.'
      }
    />
  );
}

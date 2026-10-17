'use client';

import type { Service } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin/api';
import { BILLING_CYCLE_LABELS, fmtDate } from '@/lib/admin/format';
import { SERVICE_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { ClientCell, ProductCell } from '../client-cell';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { StatusBadge } from '../status-badge';

export function ServiceTable({
  clientId,
  toolbar,
}: {
  clientId?: string;
  toolbar?: React.ReactNode;
}) {
  const { state, update, query } = useTableState(['status', 'productId'], {
    sort: 'nextDueDate',
    order: 'asc',
  });
  const q = useQuery({
    queryKey: ['services', { ...query, clientId }],
    queryFn: () => adminApi.services.list({ ...query, clientId }),
    placeholderData: (p) => p,
  });
  const products = useQuery({
    queryKey: ['products', 'lookup'],
    queryFn: () => adminApi.lookup.products(),
    staleTime: 300_000,
    retry: false,
  });

  const columns: Column<Service>[] = [
    {
      id: 'service',
      header: 'Service',
      sortKey: 'domain',
      cell: (s) => (
        <div>
          <div>
            {s.domain ?? s.username ?? <span className="text-muted-foreground">(no hostname)</span>}
          </div>
          <div className="font-normal text-muted-foreground text-xs">
            <ProductCell id={s.productId} />
          </div>
        </div>
      ),
    },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            header: 'Client',
            hideBelow: 'md',
            cell: (s: Service) => <ClientCell id={s.clientId} />,
          } as Column<Service>,
        ]),
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (s) => <StatusBadge value={s.status} map={SERVICE_STATUS} />,
    },
    {
      id: 'cycle',
      header: 'Cycle',
      hideBelow: 'lg',
      cell: (s) => BILLING_CYCLE_LABELS[s.billingCycle],
    },
    {
      id: 'amount',
      header: 'Amount',
      sortKey: 'recurringAmount',
      align: 'right',
      hideBelow: 'sm',
      cell: (s) => <Money amount={s.recurringAmount} currency={s.currency} />,
    },
    { id: 'due', header: 'Next due', sortKey: 'nextDueDate', cell: (s) => fmtDate(s.nextDueDate) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(s) => s.id}
      rowHref={(s) => `/admin/services/${s.id}`}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Domain, username…"
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: Object.entries(SERVICE_STATUS).map(([value, v]) => ({ value, label: v.label })),
        },
        {
          key: 'productId',
          label: 'Product',
          options: (products.data?.data ?? []).map((p) => ({ value: p.id, label: p.name })),
        },
      ]}
      toolbar={toolbar}
      emptyTitle="No services"
      emptyDescription={
        clientId
          ? 'This client has no services yet.'
          : 'Services are created when an order is accepted.'
      }
    />
  );
}

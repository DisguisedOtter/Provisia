'use client';

import type { Domain } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';
import { adminApi } from '@/lib/admin/api';
import { fmtDate } from '@/lib/admin/format';
import { DOMAIN_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { ClientCell } from '../client-cell';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { StatusBadge } from '../status-badge';

export function DomainTable({
  clientId,
  toolbar,
}: {
  clientId?: string;
  toolbar?: React.ReactNode;
}) {
  const { state, update, query } = useTableState(['status', 'tld', 'registrarModule'], {
    sort: 'expiryDate',
    order: 'asc',
  });
  const q = useQuery({
    queryKey: ['domains', { ...query, clientId }],
    queryFn: () => adminApi.domains.list({ ...query, clientId }),
    placeholderData: (p) => p,
  });
  const tlds = useQuery({
    queryKey: ['tlds'],
    queryFn: () => adminApi.domains.tlds.list(),
    staleTime: 300_000,
    retry: false,
  });

  const columns: Column<Domain>[] = [
    {
      id: 'name',
      header: 'Domain',
      sortKey: 'name',
      cell: (d) => (
        <span className="inline-flex items-center gap-1.5">
          {d.name}
          {d.locked ? <Lock className="size-3 text-muted-foreground" aria-label="Locked" /> : null}
          {d.autoRenew ? (
            <RefreshCw className="size-3 text-muted-foreground" aria-label="Auto-renew" />
          ) : null}
        </span>
      ),
    },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            header: 'Client',
            hideBelow: 'md',
            cell: (d: Domain) => <ClientCell id={d.clientId} />,
          } as Column<Domain>,
        ]),
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (d) => <StatusBadge value={d.status} map={DOMAIN_STATUS} />,
    },
    {
      id: 'registrar',
      header: 'Registrar',
      hideBelow: 'lg',
      cell: (d) => d.registrarModule ?? <span className="text-muted-foreground">—</span>,
    },
    { id: 'expiry', header: 'Expires', sortKey: 'expiryDate', cell: (d) => fmtDate(d.expiryDate) },
    {
      id: 'amount',
      header: 'Renewal',
      align: 'right',
      hideBelow: 'sm',
      cell: (d) => <Money amount={d.recurringAmount} currency={d.currency} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(d) => d.id}
      rowHref={(d) => `/admin/domains/${d.id}`}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Domain name…"
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: Object.entries(DOMAIN_STATUS).map(([value, v]) => ({ value, label: v.label })),
        },
        {
          key: 'tld',
          label: 'TLD',
          options: (tlds.data?.data ?? []).map((t) => ({ value: t.tld, label: `.${t.tld}` })),
        },
      ]}
      toolbar={toolbar}
      emptyTitle="No domains"
      emptyDescription={
        clientId
          ? 'This client has no domains.'
          : 'Registered and transferred domains show up here.'
      }
    />
  );
}

'use client';

import type { ClientWithUser } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/admin/api';
import { countryName } from '@/lib/admin/countries';
import { clientDisplayName, fmtDate } from '@/lib/admin/format';
import { CLIENT_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { StatusBadge } from '../status-badge';

const FILTERS = ['status', 'country'];

export function ClientList() {
  const { state, update, query } = useTableState(FILTERS, { sort: 'createdAt', order: 'desc' });
  const q = useQuery({
    queryKey: ['clients', query],
    queryFn: () => adminApi.clients.list(query),
    placeholderData: (p) => p,
  });

  const columns: Column<ClientWithUser>[] = [
    {
      id: 'name',
      header: 'Client',
      sortKey: 'companyName',
      cell: (c) => (
        <div>
          <div>{clientDisplayName(c)}</div>
          <div className="font-normal text-muted-foreground text-xs">{c.email}</div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (c) => <StatusBadge value={c.status} map={CLIENT_STATUS} />,
    },
    {
      id: 'country',
      header: 'Country',
      sortKey: 'country',
      hideBelow: 'md',
      cell: (c) => countryName(c.country),
    },
    {
      id: 'vat',
      header: 'VAT',
      hideBelow: 'lg',
      cell: (c) =>
        c.vatNumber ? (
          <span
            className={
              c.vatValidated ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
            }
          >
            {c.vatNumber}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'credit',
      header: 'Credit',
      sortKey: 'creditBalance',
      align: 'right',
      hideBelow: 'sm',
      cell: (c) => <Money amount={c.creditBalance} currency={c.currency} />,
    },
    {
      id: 'created',
      header: 'Created',
      sortKey: 'createdAt',
      hideBelow: 'lg',
      cell: (c) => fmtDate(c.createdAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Clients"
        crumbs={[{ label: 'Clients' }]}
        actions={
          <Button asChild>
            <Link href="/admin/clients/new">
              <Plus /> New client
            </Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={q.data?.data}
        total={q.data?.meta.total}
        rowKey={(c) => c.id}
        rowHref={(c) => `/admin/clients/${c.id}`}
        state={state}
        onStateChange={update}
        isPending={q.isPending}
        error={q.error}
        refetch={q.refetch}
        searchPlaceholder="Search name, email, company, VAT…"
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: Object.entries(CLIENT_STATUS).map(([value, v]) => ({ value, label: v.label })),
          },
        ]}
        emptyTitle="No clients yet"
        emptyDescription="Create your first client to start billing."
        emptyAction={
          <Button asChild size="sm">
            <Link href="/admin/clients/new">
              <Plus /> New client
            </Link>
          </Button>
        }
      />
    </>
  );
}

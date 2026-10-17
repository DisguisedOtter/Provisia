'use client';

import type { Transaction } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { adminApi } from '@/lib/admin/api';
import { fmtDateTime } from '@/lib/admin/format';
import { TRANSACTION_TYPE } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { ClientCell } from '../client-cell';
import { type Column, DataTable } from '../data-table';
import { Money } from '../money';
import { StatusBadge } from '../status-badge';

export function TransactionTable({
  clientId,
  invoiceId,
  toolbar,
}: {
  clientId?: string;
  invoiceId?: string;
  toolbar?: React.ReactNode;
}) {
  const { state, update, query } = useTableState(['type', 'gateway'], {
    sort: 'createdAt',
    order: 'desc',
  });
  const q = useQuery({
    queryKey: ['transactions', { ...query, clientId, invoiceId }],
    queryFn: () => adminApi.transactions.list({ ...query, clientId, invoiceId }),
    placeholderData: (p) => p,
  });
  const columns: Column<Transaction>[] = [
    { id: 'date', header: 'Date', sortKey: 'createdAt', cell: (t) => fmtDateTime(t.createdAt) },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            header: 'Client',
            hideBelow: 'md',
            cell: (t: Transaction) => <ClientCell id={t.clientId} />,
          } as Column<Transaction>,
        ]),
    {
      id: 'type',
      header: 'Type',
      cell: (t) => <StatusBadge value={t.type} map={TRANSACTION_TYPE} />,
    },
    {
      id: 'gateway',
      header: 'Gateway',
      hideBelow: 'sm',
      cell: (t) => <span className="capitalize">{t.gateway}</span>,
    },
    {
      id: 'ref',
      header: 'Reference',
      hideBelow: 'lg',
      cell: (t) => <span className="font-mono text-xs">{t.gatewayTxnId ?? '—'}</span>,
    },
    {
      id: 'invoice',
      header: 'Invoice',
      hideBelow: 'lg',
      cell: (t) =>
        t.invoiceId ? (
          <Link href={`/admin/invoices/${t.invoiceId}`} className="hover:underline">
            View
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      sortKey: 'amount',
      align: 'right',
      cell: (t) => (
        <Money
          amount={t.type === 'refund' ? -Math.abs(t.amount) : t.amount}
          currency={t.currency}
          signed
        />
      ),
    },
    {
      id: 'fee',
      header: 'Fee',
      align: 'right',
      hideBelow: 'xl',
      cell: (t) => <Money amount={t.fee} currency={t.currency} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(t) => t.id}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Reference, description…"
      filters={[
        {
          key: 'type',
          label: 'Type',
          options: Object.entries(TRANSACTION_TYPE).map(([value, v]) => ({
            value,
            label: v.label,
          })),
        },
        {
          key: 'gateway',
          label: 'Gateway',
          options: ['manual', 'stripe', 'mollie', 'paypal', 'btcpay', 'credit'].map((g) => ({
            value: g,
            label: g,
          })),
        },
      ]}
      toolbar={toolbar}
      emptyTitle="No transactions"
    />
  );
}

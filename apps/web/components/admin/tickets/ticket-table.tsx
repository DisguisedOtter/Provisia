'use client';

import type { TicketListItem } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin/api';
import { fmtRelative } from '@/lib/admin/format';
import { TICKET_PRIORITY, TICKET_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { type Column, DataTable } from '../data-table';
import { StatusBadge } from '../status-badge';

export function TicketTable({
  clientId,
  toolbar,
}: {
  clientId?: string;
  toolbar?: React.ReactNode;
}) {
  const { state, update, query } = useTableState(
    ['status', 'departmentId', 'assignedToUserId', 'priority'],
    { sort: 'lastReplyAt', order: 'desc' },
  );
  const q = useQuery({
    queryKey: ['tickets', { ...query, clientId }],
    queryFn: () =>
      adminApi.tickets.list({ ...query, clientId, includeClosed: Boolean(state.filters.status) }),
    placeholderData: (p) => p,
  });
  const deps = useQuery({
    queryKey: ['ticket-departments'],
    queryFn: () => adminApi.lookup.departments(),
    staleTime: 300_000,
    retry: false,
  });
  const staff = useQuery({
    queryKey: ['staff', 'lookup'],
    queryFn: () => adminApi.lookup.staff(),
    staleTime: 300_000,
    retry: false,
  });

  const columns: Column<TicketListItem>[] = [
    {
      id: 'subject',
      header: 'Ticket',
      cell: (t) => (
        <div className="max-w-md">
          <div className="truncate">
            <span className="text-muted-foreground">#{t.number}</span> {t.subject}
          </div>
          <div className="truncate font-normal text-muted-foreground text-xs">
            {t.clientName ?? t.requesterName ?? t.requesterEmail ?? 'Guest'} · {t.departmentName}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <StatusBadge value={t.status} map={TICKET_STATUS} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortKey: 'priority',
      hideBelow: 'sm',
      cell: (t) => <StatusBadge value={t.priority} map={TICKET_PRIORITY} />,
    },
    {
      id: 'assignee',
      header: 'Assignee',
      hideBelow: 'lg',
      cell: (t) => t.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      id: 'replies',
      header: 'Replies',
      align: 'center',
      hideBelow: 'xl',
      cell: (t) => t.replyCount,
    },
    {
      id: 'last',
      header: 'Last activity',
      sortKey: 'lastReplyAt',
      cell: (t) => fmtRelative(t.lastReplyAt ?? t.createdAt),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(t) => t.id}
      rowHref={(t) => `/admin/tickets/${t.id}`}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchPlaceholder="Subject, number, email…"
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: Object.entries(TICKET_STATUS).map(([value, v]) => ({ value, label: v.label })),
        },
        {
          key: 'priority',
          label: 'Priority',
          options: Object.entries(TICKET_PRIORITY).map(([value, v]) => ({ value, label: v.label })),
        },
        {
          key: 'departmentId',
          label: 'Department',
          options: (deps.data?.data ?? []).map((d) => ({ value: d.id, label: d.name })),
        },
        {
          key: 'assignedToUserId',
          label: 'Assignee',
          options: [
            { value: 'me', label: 'Assigned to me' },
            { value: 'unassigned', label: 'Unassigned' },
            ...(staff.data?.data ?? []).map((u) => ({
              value: u.id,
              label: `${u.firstName} ${u.lastName}`.trim() || u.email,
            })),
          ],
        },
      ]}
      toolbar={toolbar}
      emptyTitle="No tickets"
      emptyDescription={
        clientId
          ? 'This client has not opened any tickets.'
          : 'New tickets from the portal or email will appear here.'
      }
    />
  );
}

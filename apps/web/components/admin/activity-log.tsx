'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin/api';
import { fmtDateTime } from '@/lib/admin/format';
import type { ActivityLogEntry } from '@/lib/admin/types';
import { useTableState } from '@/lib/admin/use-table-state';
import { type Column, DataTable } from './data-table';

export function ActivityLogTable({
  entityType,
  entityId,
}: {
  entityType?: string;
  entityId?: string;
}) {
  const { state, update, query } = useTableState(['action']);
  const q = useQuery({
    queryKey: ['activity-log', { ...query, entityType, entityId }],
    queryFn: () => adminApi.activity.list({ ...query, entityType, entityId }),
    placeholderData: (p) => p,
  });
  const columns: Column<ActivityLogEntry>[] = [
    { id: 'when', header: 'When', cell: (a) => fmtDateTime(a.createdAt) },
    {
      id: 'actor',
      header: 'Actor',
      cell: (a) =>
        a.actorName ?? a.actorEmail ?? (a.actorUserId ? a.actorUserId.slice(0, 8) : 'System'),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (a) => <span className="font-mono text-xs">{a.action}</span>,
    },
    ...(entityType
      ? []
      : [
          {
            id: 'entity',
            header: 'Entity',
            hideBelow: 'md',
            cell: (a: ActivityLogEntry) => (
              <span className="font-mono text-xs">
                {a.entityType}
                {a.entityId ? `/${a.entityId.slice(0, 8)}` : ''}
              </span>
            ),
          } as Column<ActivityLogEntry>,
        ]),
    {
      id: 'diff',
      header: 'Changes',
      hideBelow: 'lg',
      cell: (a) =>
        a.diff ? (
          <details className="max-w-md">
            <summary className="cursor-pointer text-muted-foreground text-xs">
              {Object.keys(a.diff).length} field(s)
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(a.diff, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'ip',
      header: 'IP',
      hideBelow: 'xl',
      cell: (a) => <span className="font-mono text-xs">{a.ip ?? '—'}</span>,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      total={q.data?.meta.total}
      rowKey={(a) => a.id}
      state={state}
      onStateChange={update}
      isPending={q.isPending}
      error={q.error}
      refetch={q.refetch}
      searchable={false}
      emptyTitle="No activity recorded"
      dense
    />
  );
}

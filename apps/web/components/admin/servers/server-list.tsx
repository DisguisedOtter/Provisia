'use client';

import type { ServerCapacity } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { fmtRelative } from '@/lib/admin/format';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { ToneBadge } from '../status-badge';
import { ServerDialog } from './server-dialog';
import { ServerGroupsCard } from './server-groups';

export function ServerList() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['servers'], queryFn: () => adminApi.servers.list() });
  const [edit, setEdit] = useState<ServerCapacity | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: (id: string) => {
      setTesting(id);
      return adminApi.servers.test(id);
    },
    onSuccess: ({ data }) => {
      data.ok
        ? toast.success(data.message ?? 'Connection OK')
        : toast.error(data.message ?? 'Connection failed');
      qc.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setTesting(null),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.servers.remove(id),
    onSuccess: () => {
      toast.success('Server removed');
      qc.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<ServerCapacity>[] = [
    {
      id: 'name',
      header: 'Server',
      cell: (s) => (
        <div>
          <div className="flex items-center gap-2">
            {s.name}
            {!s.active ? <Badge variant="outline">Inactive</Badge> : null}
          </div>
          <div className="font-normal text-muted-foreground text-xs">
            {s.hostname}
            {s.ipAddress ? ` · ${s.ipAddress}` : ''}
          </div>
        </div>
      ),
    },
    {
      id: 'module',
      header: 'Module',
      hideBelow: 'sm',
      cell: (s) => <span className="capitalize">{s.module}</span>,
    },
    {
      id: 'group',
      header: 'Group',
      hideBelow: 'md',
      cell: (s) => s.groupName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'capacity',
      header: 'Capacity',
      cell: (s) => {
        const pct =
          s.maxAccounts > 0
            ? Math.min(100, Math.round((s.usedAccounts / s.maxAccounts) * 100))
            : null;
        return (
          <div className="min-w-32">
            <div className="flex justify-between text-xs">
              <span>
                {s.usedAccounts}
                {s.maxAccounts > 0 ? ` / ${s.maxAccounts}` : ''} accounts
              </span>
              {s.full ? <span className="text-red-600">full</span> : null}
            </div>
            {pct !== null ? (
              <Progress
                value={pct}
                className={
                  pct >= 90 ? '[&>div]:bg-red-500' : pct >= 75 ? '[&>div]:bg-amber-500' : ''
                }
              />
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Last check',
      hideBelow: 'lg',
      cell: (s) =>
        s.status.ok === null ? (
          <span className="text-muted-foreground">Never tested</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <ToneBadge tone={s.status.ok ? 'success' : 'danger'}>
              {s.status.ok ? 'OK' : 'Failed'}
            </ToneBadge>
            <span className="text-muted-foreground text-xs">{fmtRelative(s.status.checkedAt)}</span>
          </span>
        ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (s) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => test.mutate(s.id)}
            disabled={testing === s.id}
          >
            {testing === s.id ? <Loader2 className="animate-spin" /> : <Activity />} Test
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit server"
            onClick={() => setEdit(s)}
          >
            <Pencil />
          </Button>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            aria-label="Delete server"
            title={`Remove ${s.name}?`}
            description="Servers with active services cannot be removed."
            destructive
            confirmLabel="Remove"
            onConfirm={() => remove.mutateAsync(s.id)}
          >
            <Trash2 />
          </ConfirmButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Servers"
        crumbs={[{ label: 'Servers' }]}
        description="Provisioning targets. Credentials are encrypted at rest and never shown again."
        actions={
          <Button onClick={() => setEdit('new')}>
            <Plus /> Add server
          </Button>
        }
      />
      <div className="space-y-6">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          <SimpleTable
            columns={columns}
            rows={q.data?.data ?? []}
            rowKey={(s) => s.id}
            emptyTitle="No servers yet"
            emptyDescription="Add a cPanel, Plesk, DirectAdmin or Proxmox server to start provisioning."
          />
        </QueryState>
        <ServerGroupsCard />
      </div>
      {edit ? (
        <ServerDialog server={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
      ) : null}
    </>
  );
}

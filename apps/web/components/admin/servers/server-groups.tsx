'use client';

import type { ServerGroup } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { QueryState } from '../query-state';

export function ServerGroupsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['server-groups'],
    queryFn: () => adminApi.servers.groups.list(),
    retry: false,
  });
  const [name, setName] = useState('');
  const [fill, setFill] = useState<'least_loaded' | 'fill_first'>('least_loaded');
  const create = useMutation({
    mutationFn: () => adminApi.servers.groups.create({ name: name.trim(), fillType: fill }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['server-groups'] });
      toast.success('Group created');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, fillType }: { id: string; fillType: 'least_loaded' | 'fill_first' }) =>
      adminApi.servers.groups.update(id, { fillType }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-groups'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.servers.groups.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-groups'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<ServerGroup>[] = [
    { id: 'name', header: 'Group', cell: (g) => g.name },
    {
      id: 'fill',
      header: 'Placement',
      cell: (g) => (
        <Select
          value={g.fillType}
          onValueChange={(v) =>
            update.mutate({ id: g.id, fillType: v as 'least_loaded' | 'fill_first' })
          }
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="least_loaded">Least loaded</SelectItem>
            <SelectItem value="fill_first">Fill first</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    { id: 'desc', header: 'Description', hideBelow: 'md', cell: (g) => g.description ?? '—' },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (g) => (
        <ConfirmButton
          variant="ghost"
          size="icon-sm"
          aria-label="Delete group"
          title={`Delete group ${g.name}?`}
          destructive
          confirmLabel="Delete"
          onConfirm={() => remove.mutateAsync(g.id)}
        >
          <Trash2 />
        </ConfirmButton>
      ),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server groups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group name"
            className="w-56"
            aria-label="Group name"
          />
          <Select value={fill} onValueChange={(v) => setFill(v as typeof fill)}>
            <SelectTrigger className="w-40" aria-label="Placement strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="least_loaded">Least loaded</SelectItem>
              <SelectItem value="fill_first">Fill first</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
            <Plus /> Add group
          </Button>
        </form>
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch} compact>
          <SimpleTable
            columns={columns}
            rows={q.data?.data ?? []}
            rowKey={(g) => g.id}
            emptyTitle="No groups"
            emptyDescription="Products reference a group; new services go to a server in that group."
            dense
          />
        </QueryState>
      </CardContent>
    </Card>
  );
}

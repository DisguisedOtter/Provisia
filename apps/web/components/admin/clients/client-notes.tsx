'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { fmtDateTime } from '@/lib/admin/format';
import { ConfirmButton } from '../confirm-dialog';
import { EmptyState } from '../empty-state';
import { QueryState } from '../query-state';

export function ClientNotes({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const q = useQuery({
    queryKey: ['clients', clientId, 'notes'],
    queryFn: () => adminApi.clients.notes.list(clientId),
  });
  const add = useMutation({
    mutationFn: () => adminApi.clients.notes.create(clientId, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['clients', clientId, 'notes'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.clients.notes.remove(clientId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients', clientId, 'notes'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
        className="space-y-2"
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add an internal note (not visible to the client)…"
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </form>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch} compact>
        {q.data && q.data.data.length === 0 ? (
          <EmptyState title="No notes yet" className="py-8" />
        ) : (
          <ul className="space-y-3">
            {q.data?.data.map((n) => (
              <li key={n.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-muted-foreground text-xs">
                    {n.authorName ?? 'Staff'} · {fmtDateTime(n.createdAt)}
                  </div>
                  <ConfirmButton
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Delete note"
                    title="Delete note?"
                    destructive
                    confirmLabel="Delete"
                    onConfirm={() => remove.mutateAsync(n.id)}
                  >
                    <Trash2 />
                  </ConfirmButton>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

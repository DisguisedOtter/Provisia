'use client';

import type { EmailLogEntry } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { fmtDateTime } from '@/lib/admin/format';
import { JOB_STATUS } from '@/lib/admin/status';
import { useTableState } from '@/lib/admin/use-table-state';
import { type Column, DataTable } from './data-table';
import { QueryState } from './query-state';
import { StatusBadge } from './status-badge';

export function EmailLogTable({
  relatedType,
  relatedId,
  to,
}: {
  relatedType?: string;
  relatedId?: string;
  to?: string;
}) {
  const qc = useQueryClient();
  const { state, update, query } = useTableState(['status', 'templateKey']);
  const [view, setView] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['email-log', { ...query, relatedType, relatedId, to }],
    queryFn: () => adminApi.settings.email.log({ ...query, relatedType, relatedId, to }),
    placeholderData: (p) => p,
  });
  const resend = useMutation({
    mutationFn: (id: string) => adminApi.settings.email.resend(id),
    onSuccess: () => {
      toast.success('Email queued again');
      qc.invalidateQueries({ queryKey: ['email-log'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<EmailLogEntry>[] = [
    { id: 'when', header: 'Date', cell: (e) => fmtDateTime(e.sentAt ?? e.createdAt) },
    { id: 'to', header: 'To', cell: (e) => e.toEmail },
    {
      id: 'subject',
      header: 'Subject',
      cell: (e) => <span className="line-clamp-1 max-w-sm">{e.subject}</span>,
    },
    {
      id: 'template',
      header: 'Template',
      hideBelow: 'lg',
      cell: (e) => <span className="font-mono text-xs">{e.templateKey ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => <StatusBadge value={e.status} map={JOB_STATUS} />,
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View email"
            onClick={() => setView(e.id)}
          >
            <Eye />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Resend"
            onClick={() => resend.mutate(e.id)}
            disabled={resend.isPending}
          >
            <RotateCw />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        total={q.data?.meta.total}
        rowKey={(e) => e.id}
        state={state}
        onStateChange={update}
        isPending={q.isPending}
        error={q.error}
        refetch={q.refetch}
        searchPlaceholder="Recipient, subject…"
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: ['queued', 'sent', 'failed', 'bounced'].map((s) => ({ value: s, label: s })),
          },
        ]}
        emptyTitle="No emails sent"
        dense
      />
      {view ? <EmailViewDialog id={view} onClose={() => setView(null)} /> : null}
    </>
  );
}

function EmailViewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['email-log', id],
    queryFn: () => adminApi.settings.email.logEntry(id),
  });
  const e = q.data?.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{e?.subject ?? 'Email'}</DialogTitle>
        </DialogHeader>
        <QueryState isPending={q.isPending} error={q.error} compact>
          {e ? (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">
                To {e.toEmail} · {fmtDateTime(e.sentAt ?? e.createdAt)} ·{' '}
                <StatusBadge value={e.status} map={JOB_STATUS} />
              </div>
              {e.error ? (
                <p className="rounded bg-destructive/10 p-2 text-destructive text-xs">{e.error}</p>
              ) : null}
              {e.bodyHtml ? (
                <iframe
                  title="Email body"
                  sandbox=""
                  srcDoc={e.bodyHtml}
                  className="h-[60vh] w-full rounded border bg-white"
                />
              ) : (
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border p-3">
                  {e.bodyText}
                </pre>
              )}
            </div>
          ) : null}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

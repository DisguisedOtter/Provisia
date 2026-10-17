'use client';

import type { TicketReply } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { portalApi } from '@/lib/portal/api';
import { fmtDateTime } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';
import { AttachmentsInput } from '../attachments-input';
import { ConfirmDialog } from '../confirm-dialog';
import { KeyValue } from '../key-value';
import { PageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { DetailSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

function Message({
  reply,
  ticketId,
  mine,
}: {
  reply: TicketReply;
  ticketId: string;
  mine: boolean;
}) {
  const { t, locale } = useI18n();
  const name =
    reply.authorName ??
    reply.authorEmail ??
    (reply.isStaff ? t('tickets.staff') : t('tickets.you'));
  return (
    <div className={cn('flex gap-3', mine && 'flex-row-reverse')}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback
          className={cn('text-xs', reply.isStaff && 'bg-primary text-primary-foreground')}
        >
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          'min-w-0 max-w-[85%] rounded-lg border px-4 py-3',
          mine ? 'bg-primary/5' : 'bg-card',
        )}
      >
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium">{name}</span>
          {reply.isStaff ? (
            <span className="rounded bg-muted px-1 text-[10px] uppercase">
              {t('tickets.staff')}
            </span>
          ) : null}
          <span className="text-muted-foreground">{fmtDateTime(reply.createdAt, locale)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">{reply.body}</div>
        {reply.attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {reply.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={portalApi.tickets.attachmentUrl(ticketId, a.id)}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Paperclip className="size-3" /> {a.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function TicketDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [closeOpen, setCloseOpen] = useState(false);
  const query = useQuery({
    queryKey: portalKeys.ticket(id),
    queryFn: async () => (await portalApi.tickets.get(id)).data,
    refetchInterval: 30_000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: portalKeys.ticket(id) });
    qc.invalidateQueries({ queryKey: ['portal', 'tickets'] });
  };
  const reply = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(files.map((f) => portalApi.tickets.uploadAttachment(f)));
      return portalApi.tickets.reply(id, { body, attachmentIds: uploaded.map((u) => u.data.id) });
    },
    onSuccess: () => {
      toast.success(t('tickets.replySent'));
      setBody('');
      setFiles([]);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const close = useMutation({
    mutationFn: () => portalApi.tickets.close(id),
    onSuccess: () => {
      toast.success(t('tickets.closed'));
      setCloseOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  return (
    <QueryState query={query} skeleton={<DetailSkeleton />} kind="item">
      {(tk) => (
        <div className="space-y-6">
          <PageHeader
            back={{ href: '/portal/tickets', label: t('tickets.title') }}
            title={tk.subject}
            badge={<StatusBadge status={tk.status} />}
            description={`#${tk.number} · ${t('tickets.opened', { date: fmtDateTime(tk.createdAt, locale) })}`}
          >
            {tk.status !== 'closed' ? (
              <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                {t('tickets.close')}
              </Button>
            ) : null}
          </PageHeader>

          <Card>
            <CardContent>
              <KeyValue
                className="sm:grid-cols-4"
                items={[
                  { label: t('tickets.department'), value: tk.departmentName },
                  { label: t('tickets.priority'), value: t(`tickets.priority.${tk.priority}`) },
                  {
                    label: t('tickets.related'),
                    value: tk.service
                      ? tk.service.label
                      : tk.domain
                        ? tk.domain.name
                        : t('tickets.relatedNone'),
                  },
                  { label: t('tickets.lastReply'), value: fmtDateTime(tk.lastReplyAt, locale) },
                ]}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            {tk.replies
              .filter((r) => !r.internal)
              .map((r) => (
                <Message
                  key={r.id}
                  reply={r}
                  ticketId={tk.id}
                  mine={!r.isStaff && (r.authorUserId === me?.id || r.authorUserId === null)}
                />
              ))}
          </div>

          <Card>
            <CardContent className="space-y-3">
              {tk.status === 'closed' ? (
                <Alert>
                  <AlertDescription>{t('tickets.closedNotice')}</AlertDescription>
                </Alert>
              ) : null}
              <Textarea
                rows={5}
                placeholder={t('tickets.replyPlaceholder')}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AttachmentsInput files={files} onChange={setFiles} />
                <Button disabled={!body.trim() || reply.isPending} onClick={() => reply.mutate()}>
                  {reply.isPending ? t('common.submitting') : t('tickets.sendReply')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <ConfirmDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            title={t('tickets.close')}
            description={t('tickets.closeConfirm')}
            confirmLabel={t('tickets.close')}
            pending={close.isPending}
            onConfirm={() => close.mutate()}
          />
        </div>
      )}
    </QueryState>
  );
}

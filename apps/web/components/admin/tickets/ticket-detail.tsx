'use client';

import {
  TICKET_TRANSITIONS,
  type TicketDetail as TicketDetailDto,
  type TicketReply,
  type TicketStatus,
} from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  Loader2,
  Lock,
  MessageSquareText,
  Paperclip,
  Pencil,
  Send,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { fmtDateTime, fmtRelative } from '@/lib/admin/format';
import { TICKET_PRIORITY, TICKET_STATUS } from '@/lib/admin/status';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ClientCell } from '../client-cell';
import { ConfirmButton } from '../confirm-dialog';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatusBadge } from '../status-badge';
import { Markdown } from './markdown';

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['tickets', id],
    queryFn: () => adminApi.tickets.get(id),
    refetchInterval: 30_000,
  });
  const t = q.data?.data;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  const update = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.tickets.update>[1]) =>
      adminApi.tickets.update(id, body),
    onSuccess: () => {
      invalidate();
      toast.success('Ticket updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <AdminPageHeader
        crumbs={[{ label: 'Tickets', href: '/admin/tickets' }, { label: t ? `#${t.number}` : '…' }]}
        title={t ? t.subject : 'Ticket'}
        description={
          t ? (
            <>
              #{t.number} · {t.departmentName} · opened {fmtRelative(t.createdAt)}
              {t.clientId ? (
                <>
                  {' '}
                  by <ClientCell id={t.clientId} />
                </>
              ) : t.requesterEmail ? (
                ` by ${t.requesterName ?? ''} <${t.requesterEmail}>`
              ) : null}
            </>
          ) : undefined
        }
        badges={
          t ? (
            <>
              <StatusBadge value={t.status} map={TICKET_STATUS} />
              <StatusBadge value={t.priority} map={TICKET_PRIORITY} />
            </>
          ) : null
        }
        actions={
          t && t.status !== 'closed' ? (
            <ConfirmButton
              variant="outline"
              title="Close this ticket?"
              description="The client can reopen it by replying."
              confirmLabel="Close ticket"
              onConfirm={() => update.mutateAsync({ status: 'closed' })}
            >
              <Lock /> Close
            </ConfirmButton>
          ) : t ? (
            <Button variant="outline" onClick={() => update.mutate({ status: 'open' })}>
              Reopen
            </Button>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {t ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Conversation ticket={t} />
              <ReplyEditor ticket={t} />
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Properties</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <PropSelect
                    label="Status"
                    value={t.status}
                    options={[t.status, ...TICKET_TRANSITIONS[t.status]].map((s) => ({
                      value: s,
                      label: TICKET_STATUS[s as TicketStatus].label,
                    }))}
                    onChange={(v) => update.mutate({ status: v as TicketStatus })}
                  />
                  <PropSelect
                    label="Priority"
                    value={t.priority}
                    options={Object.entries(TICKET_PRIORITY).map(([value, v]) => ({
                      value,
                      label: v.label,
                    }))}
                    onChange={(v) => update.mutate({ priority: v as TicketDetailDto['priority'] })}
                  />
                  <AssigneeSelect
                    value={t.assignedToUserId}
                    onChange={(v) => update.mutate({ assignedToUserId: v })}
                  />
                  <DepartmentSelect
                    value={t.departmentId}
                    onChange={(v) => update.mutate({ departmentId: v })}
                  />
                  <div className="space-y-1 text-sm">
                    <Label>Linked</Label>
                    <div className="text-muted-foreground">
                      {t.service ? (
                        <Link
                          className="block hover:underline"
                          href={`/admin/services/${t.service.id}`}
                        >
                          Service: {t.service.label}
                        </Link>
                      ) : null}
                      {t.domain ? (
                        <Link
                          className="block hover:underline"
                          href={`/admin/domains/${t.domain.id}`}
                        >
                          Domain: {t.domain.name}
                        </Link>
                      ) : null}
                      {!t.service && !t.domain ? '—' : null}
                    </div>
                  </div>
                  {t.cc.length ? (
                    <div className="text-sm">
                      <Label>CC</Label>
                      <div className="text-muted-foreground">{t.cc.join(', ')}</div>
                    </div>
                  ) : null}
                  <div className="text-muted-foreground text-xs">
                    First response: {fmtDateTime(t.firstResponseAt)}
                    <br />
                    Last reply: {fmtDateTime(t.lastReplyAt)}{' '}
                    {t.lastReplyBy ? `(${t.lastReplyBy})` : ''}
                  </div>
                </CardContent>
              </Card>
              <InternalNotes ticket={t} />
            </div>
          </div>
        ) : null}
      </QueryState>
    </>
  );
}

function PropSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AssigneeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const staff = useQuery({
    queryKey: ['staff', 'lookup'],
    queryFn: () => adminApi.lookup.staff(),
    staleTime: 300_000,
    retry: false,
  });
  const { data: me } = useMe();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>Assignee</Label>
        {me && value !== me.id ? (
          <Button variant="link" size="xs" onClick={() => onChange(me.id)}>
            Assign to me
          </Button>
        ) : null}
      </div>
      <Select value={value ?? '__none'} onValueChange={(v) => onChange(v === '__none' ? null : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Unassigned</SelectItem>
          {(staff.data?.data ?? []).map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {`${u.firstName} ${u.lastName}`.trim() || u.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DepartmentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const deps = useQuery({
    queryKey: ['ticket-departments'],
    queryFn: () => adminApi.lookup.departments(),
    staleTime: 300_000,
  });
  return (
    <PropSelect
      label="Department"
      value={value}
      options={(deps.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
      onChange={onChange}
    />
  );
}

function Conversation({ ticket }: { ticket: TicketDetailDto }) {
  return (
    <ol className="space-y-3">
      {ticket.replies.map((r) => (
        <ReplyBubble key={r.id} ticketId={ticket.id} reply={r} />
      ))}
      {ticket.replies.length === 0 ? (
        <li className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          No messages yet.
        </li>
      ) : null}
    </ol>
  );
}

function ReplyBubble({ ticketId, reply }: { ticketId: string; reply: TicketReply }) {
  const name = reply.authorName ?? reply.authorEmail ?? (reply.isStaff ? 'Staff' : 'Client');
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <li
      className={cn(
        'rounded-lg border',
        reply.internal
          ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10'
          : reply.isStaff
            ? 'bg-muted/40'
            : 'bg-card',
      )}
    >
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{name}</span>
          <span className="ml-2 text-muted-foreground text-xs">
            {reply.isStaff ? 'Staff' : 'Client'} · via {reply.source} ·{' '}
            {fmtDateTime(reply.createdAt)}
          </span>
        </div>
        {reply.internal ? (
          <span className="inline-flex items-center gap-1 text-amber-700 text-xs dark:text-amber-300">
            <StickyNote className="size-3" /> Internal
          </span>
        ) : null}
      </div>
      <div className="px-4 py-3">
        <Markdown>{reply.body}</Markdown>
        {reply.attachments.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {reply.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={adminApi.tickets.attachmentUrl(ticketId, a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Paperclip className="size-3" /> {a.name}{' '}
                  <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function ReplyEditor({ ticket }: { ticket: TicketDetailDto }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState<TicketStatus | 'auto'>('auto');
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canned = useQuery({
    queryKey: ['canned-responses'],
    queryFn: () => adminApi.tickets.canned.list(),
    staleTime: 300_000,
    retry: false,
  });

  const send = useMutation({
    mutationFn: async (): Promise<void> => {
      if (internal) {
        await adminApi.tickets.addNote(ticket.id, { body });
        return;
      }
      await adminApi.tickets.reply(ticket.id, {
        body,
        attachmentIds: files.map((f) => f.id),
        ...(status !== 'auto' ? { status } : {}),
      });
    },
    onSuccess: () => {
      setBody('');
      setFiles([]);
      setStatus('auto');
      setPreview(false);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(internal ? 'Note added' : 'Reply sent');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const res = await adminApi.tickets.upload(ticket.id, f);
        setFiles((prev) => [...prev, { id: res.data.id, name: res.data.name }]);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Card className={cn(internal && 'border-amber-300 dark:border-amber-500/40')}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          {internal ? (
            <>
              <StickyNote className="size-4" /> Internal note
            </>
          ) : (
            <>
              <MessageSquareText className="size-4" /> Reply
            </>
          )}
        </CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="internal-toggle" className="text-muted-foreground">
            Internal
          </Label>
          <Switch id="internal-toggle" checked={internal} onCheckedChange={setInternal} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs
          value={preview ? 'preview' : 'write'}
          onValueChange={(v) => setPreview(v === 'preview')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="write">
                <Pencil /> Write
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye /> Preview
              </TabsTrigger>
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!canned.data?.data.length}>
                  <MessageSquareText /> Canned responses
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-72 overflow-y-auto">
                {(canned.data?.data ?? []).map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setBody((b) => (b ? `${b}\n\n${c.body}` : c.body))}
                  >
                    {c.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <TabsContent value="write">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={
                internal
                  ? 'Visible to staff only…'
                  : 'Write your reply… Markdown supported. Ctrl/⌘+Enter to send.'
              }
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) send.mutate();
              }}
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="min-h-32 rounded-md border p-3">
              {body.trim() ? (
                <Markdown>{body}</Markdown>
              ) : (
                <span className="text-muted-foreground text-sm">Nothing to preview.</span>
              )}
            </div>
          </TabsContent>
        </Tabs>
        {!internal ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} Attach
            </Button>
            {files.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
              >
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!internal ? (
            <Select value={status} onValueChange={(v) => setStatus(v as TicketStatus | 'auto')}>
              <SelectTrigger size="sm" className="w-56" aria-label="Status after reply">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Status: Answered (default)</SelectItem>
                {(['open', 'on_hold', 'closed'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    Status: {TICKET_STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}{' '}
            {internal ? 'Add note' : 'Send reply'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InternalNotes({ ticket }: { ticket: TicketDetailDto }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (noteId: string) => adminApi.tickets.removeNote(ticket.id, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets', ticket.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="size-4" /> Internal notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ticket.notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No internal notes. Toggle “Internal” in the editor to add one.
          </p>
        ) : (
          <ul className="space-y-3">
            {ticket.notes.map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
              >
                <div className="flex items-start justify-between gap-2 text-muted-foreground text-xs">
                  <span>
                    {n.authorName ?? 'Staff'} · {fmtDateTime(n.createdAt)}
                  </span>
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
                <Markdown className="mt-1">{n.body}</Markdown>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

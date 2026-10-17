'use client';

import type { ModuleExtraDescriptor } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Globe, RotateCw, Shield, Terminal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { useI18n } from '@/lib/portal/i18n';
import type { ServiceDetail } from '@/lib/portal/types';
import { ConfirmDialog } from '../confirm-dialog';
import { CopyButton } from '../copy-button';
import { ErrorState } from '../error-boundary';

interface NetworkEntry {
  ipAddress: string;
  gateway: string | null;
  hostname: string | null;
  zone: string | null;
}
interface FirewallRule {
  pos: number;
  type: 'in' | 'out';
  action: string;
  enabled?: boolean;
  protocol?: string;
  source?: string;
  sourcePort?: string;
  destination?: string;
  destinationPort?: string;
}
interface Backup {
  volid: string;
  size?: string;
  createdAt?: string;
}
interface OsImage {
  id: string;
  name: string;
  extra?: { group?: string | null };
}

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;
const keys = {
  extras: (id: string) => ['portal', 'services', id, 'extras'] as const,
  extra: (id: string, action: string) => ['portal', 'services', id, 'extras', action] as const,
};

/**
 * Module specific tools (Skrime KVM servers): console, network + rDNS, firewall, backups, reinstall.
 * Renders nothing when the service's module exposes no actions.
 */
export function ServerToolsPanel({ service }: { service: ServiceDetail }) {
  const { t } = useI18n();
  const extras = useQuery({
    queryKey: keys.extras(service.id),
    queryFn: async () => (await portalApi.services.extras(service.id)).data,
    staleTime: 300_000,
    retry: false,
  });
  const ids = new Set((extras.data ?? []).map((e: ModuleExtraDescriptor) => e.id));
  if (!extras.data || ids.size === 0) return null;
  const active = service.status === 'active';
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('tools.title')}</CardTitle>
        {ids.has('console') ? <ConsoleButton service={service} disabled={!active} /> : null}
      </CardHeader>
      <CardContent className="space-y-8">
        {ids.has('network') ? (
          <NetworkSection service={service} canEdit={active && ids.has('rdns.set')} />
        ) : null}
        {ids.has('firewall.list') ? <FirewallSection service={service} canEdit={active} /> : null}
        {ids.has('backup.list') ? (
          <BackupSection service={service} canRestore={active && ids.has('backup.restore')} />
        ) : null}
        {ids.has('reinstall') && ids.has('os.list') ? (
          <ReinstallSection service={service} disabled={!active} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConsoleButton({ service, disabled }: { service: ServiceDetail; disabled: boolean }) {
  const { t } = useI18n();
  const m = useMutation({
    mutationFn: () => portalApi.services.runExtra<{ url: string }>(service.id, 'console'),
    onSuccess: ({ data }) => window.open(data.url, '_blank', 'noopener'),
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || m.isPending}
      onClick={() => m.mutate()}
      title={t('tools.consoleHint')}
    >
      <Terminal className="size-4" /> {t('tools.console')}
    </Button>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Globe; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-medium text-sm">
      <Icon className="size-4 text-muted-foreground" /> {children}
    </h3>
  );
}

/* ---------- Network + rDNS ---------- */
function NetworkSection({ service, canEdit }: { service: ServiceDetail; canEdit: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.extra(service.id, 'network'),
    queryFn: async () =>
      (
        await portalApi.services.runExtra<{ ipv4: NetworkEntry[]; ipv6: NetworkEntry[] }>(
          service.id,
          'network',
        )
      ).data,
    staleTime: 60_000,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (v: { ipAddress: string; hostname: string }) =>
      portalApi.services.runExtra(service.id, 'rdns.set', v),
    onSuccess: () => {
      toast.success(t('tools.rdnsSaved'));
      qc.invalidateQueries({ queryKey: keys.extra(service.id, 'network') });
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const remove = useMutation({
    mutationFn: (ipAddress: string) =>
      portalApi.services.runExtra(service.id, 'rdns.delete', { ipAddress }),
    onSuccess: () => {
      toast.success(t('tools.rdnsSaved'));
      qc.invalidateQueries({ queryKey: keys.extra(service.id, 'network') });
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const rows = [...(q.data?.ipv4 ?? []), ...(q.data?.ipv6 ?? [])];
  const bareIp = (ip: string) => ip.replace(/\/\d+$/, '');
  return (
    <section className="space-y-3">
      <SectionTitle icon={Globe}>{t('tools.network')}</SectionTitle>
      {q.isPending ? (
        <Skeleton className="h-20" />
      ) : q.isError ? (
        <ErrorState error={q.error} compact />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('tools.ipAddress')}</TableHead>
              <TableHead>{t('tools.gateway')}</TableHead>
              <TableHead>{t('tools.rdns')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const key = r.ipAddress;
              const value = drafts[key] ?? r.hostname ?? '';
              return (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{r.ipAddress}</TableCell>
                  <TableCell className="font-mono text-xs">{r.gateway ?? '—'}</TableCell>
                  <TableCell>
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save.mutate({ ipAddress: bareIp(key), hostname: value });
                      }}
                    >
                      <Input
                        value={value}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        placeholder="server.example.com"
                        className="h-8 w-56 font-mono text-xs"
                        disabled={!canEdit}
                        aria-label={t('tools.rdns')}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={!canEdit || save.isPending || !value}
                      >
                        {t('tools.rdnsSave')}
                      </Button>
                      {r.hostname ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!canEdit || remove.isPending}
                          onClick={() => remove.mutate(bareIp(key))}
                          aria-label={t('tools.rdnsDelete')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/* ---------- Firewall ---------- */
function FirewallSection({ service, canEdit }: { service: ServiceDetail; canEdit: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.extra(service.id, 'firewall.list'),
    queryFn: async () =>
      (await portalApi.services.runExtra<{ rules: FirewallRule[] }>(service.id, 'firewall.list'))
        .data.rules,
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState({
    type: 'in',
    action: 'ACCEPT',
    protocol: 'tcp',
    source: '',
    destinationPort: '',
  });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.extra(service.id, 'firewall.list') });
  const add = useMutation({
    mutationFn: () =>
      portalApi.services.runExtra(service.id, 'firewall.create', {
        rule: {
          type: draft.type,
          action: draft.action,
          enable: 1,
          protocol: draft.protocol,
          ...(draft.source ? { source: draft.source } : {}),
          ...(draft.destinationPort ? { destinationPort: draft.destinationPort } : {}),
        },
      }),
    onSuccess: () => {
      toast.success(t('tools.firewallAdded'));
      setDraft((d) => ({ ...d, source: '', destinationPort: '' }));
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const remove = useMutation({
    mutationFn: (pos: number) =>
      portalApi.services.runExtra(service.id, 'firewall.delete', { pos }),
    onSuccess: () => {
      toast.success(t('tools.firewallDeleted'));
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <section className="space-y-3">
      <SectionTitle icon={Shield}>{t('tools.firewall')}</SectionTitle>
      {q.isPending ? (
        <Skeleton className="h-20" />
      ) : q.isError ? (
        <ErrorState error={q.error} compact />
      ) : q.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('tools.firewallEmpty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t('tools.direction')}</TableHead>
              <TableHead>{t('tools.action')}</TableHead>
              <TableHead>{t('tools.protocol')}</TableHead>
              <TableHead>{t('tools.source')}</TableHead>
              <TableHead>{t('tools.port')}</TableHead>
              <TableHead>{t('tools.enabled')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((r) => (
              <TableRow key={r.pos}>
                <TableCell>{r.pos}</TableCell>
                <TableCell>{r.type === 'in' ? t('tools.in') : t('tools.out')}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>{r.protocol || '*'}</TableCell>
                <TableCell className="font-mono text-xs">{r.source || '*'}</TableCell>
                <TableCell className="font-mono text-xs">{r.destinationPort || '*'}</TableCell>
                <TableCell>{r.enabled === false ? '—' : '✓'}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit || remove.isPending}
                    onClick={() => remove.mutate(r.pos)}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canEdit ? (
        <form
          className="grid gap-2 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}>
            <SelectTrigger aria-label={t('tools.direction')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">{t('tools.in')}</SelectItem>
              <SelectItem value="out">{t('tools.out')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={draft.action}
            onValueChange={(v) => setDraft((d) => ({ ...d, action: v }))}
          >
            <SelectTrigger aria-label={t('tools.action')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACCEPT">ACCEPT</SelectItem>
              <SelectItem value="DROP">DROP</SelectItem>
              <SelectItem value="REJECT">REJECT</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={draft.protocol}
            onValueChange={(v) => setDraft((d) => ({ ...d, protocol: v }))}
          >
            <SelectTrigger aria-label={t('tools.protocol')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
              <SelectItem value="icmp">ICMP</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={draft.source}
            onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
            placeholder={`${t('tools.source')} (CIDR)`}
            className="font-mono text-xs"
            aria-label={t('tools.source')}
          />
          <Input
            value={draft.destinationPort}
            onChange={(e) => setDraft((d) => ({ ...d, destinationPort: e.target.value }))}
            placeholder={t('tools.port')}
            className="font-mono text-xs"
            aria-label={t('tools.port')}
          />
          <Button type="submit" variant="outline" disabled={add.isPending}>
            {t('tools.firewallAdd')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/* ---------- Backups ---------- */
function BackupSection({ service, canRestore }: { service: ServiceDetail; canRestore: boolean }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: keys.extra(service.id, 'backup.list'),
    queryFn: async () =>
      (await portalApi.services.runExtra<{ backups: Backup[] }>(service.id, 'backup.list')).data
        .backups,
    staleTime: 60_000,
  });
  const [pending, setPending] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (volid: string) =>
      portalApi.services.runExtra(service.id, 'backup.restore', { volid }),
    onSuccess: () => {
      toast.success(t('tools.restoreStarted'));
      setPending(null);
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <section className="space-y-3">
      <SectionTitle icon={Archive}>{t('tools.backups')}</SectionTitle>
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : q.isError ? (
        <ErrorState error={q.error} compact />
      ) : q.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('tools.backupsEmpty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('tools.created')}</TableHead>
              <TableHead>{t('tools.size')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((b) => (
              <TableRow key={b.volid}>
                <TableCell>{b.createdAt ?? b.volid}</TableCell>
                <TableCell>{b.size ? `${b.size} GB` : '—'}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canRestore || restore.isPending}
                    onClick={() => setPending(b.volid)}
                  >
                    <RotateCw className="size-4" /> {t('tools.restore')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('tools.restore')}
        description={t('tools.restoreConfirm')}
        confirmLabel={t('tools.restore')}
        destructive
        pending={restore.isPending}
        onConfirm={() => pending && restore.mutate(pending)}
      />
    </section>
  );
}

/* ---------- Reinstall ---------- */
function ReinstallSection({ service, disabled }: { service: ServiceDetail; disabled: boolean }) {
  const { t } = useI18n();
  const images = useQuery({
    queryKey: keys.extra(service.id, 'os.list'),
    queryFn: async () =>
      (await portalApi.services.runExtra<{ images: OsImage[] }>(service.id, 'os.list')).data.images,
    staleTime: 600_000,
  });
  const [osName, setOsName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ osName: string; newPassword: string } | null>(null);
  const m = useMutation({
    mutationFn: () =>
      portalApi.services.runExtra<{ osName: string; newPassword: string }>(
        service.id,
        'reinstall',
        { osName },
      ),
    onSuccess: ({ data }) => {
      setConfirm(false);
      setResult(data);
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <section className="space-y-3">
      <SectionTitle icon={RotateCw}>{t('tools.reinstall')}</SectionTitle>
      <p className="text-muted-foreground text-sm">{t('tools.reinstallHint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="reinstall-os">{t('tools.os')}</Label>
          <Select value={osName} onValueChange={setOsName} disabled={disabled || images.isPending}>
            <SelectTrigger id="reinstall-os" className="w-64">
              <SelectValue placeholder={t('tools.os')} />
            </SelectTrigger>
            <SelectContent>
              {(images.data ?? []).map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="destructive"
          disabled={disabled || !osName || m.isPending}
          onClick={() => setConfirm(true)}
        >
          {t('tools.reinstall')}
        </Button>
      </div>
      {result ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p>{t('tools.reinstallDone')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-background px-2 py-1 font-mono">{result.newPassword}</code>
            <CopyButton value={result.newPassword} label={t('tools.newPassword')} />
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('tools.reinstall')}
        description={t('tools.reinstallConfirm')}
        confirmLabel={t('tools.reinstall')}
        destructive
        pending={m.isPending}
        onConfirm={() => m.mutate()}
      />
    </section>
  );
}

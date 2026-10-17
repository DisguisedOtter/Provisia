'use client';

import type { ProvisioningLog, Service } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ExternalLink,
  KeyRound,
  Loader2,
  Pause,
  Pencil,
  Play,
  PlusCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/admin/api';
import { errorMessage, isMissingEndpoint } from '@/lib/admin/form-errors';
import { BILLING_CYCLE_LABELS, fmtBytesMb, fmtDate, fmtDateTime } from '@/lib/admin/format';
import { JOB_STATUS, SERVICE_STATUS } from '@/lib/admin/status';
import { ActivityLogTable } from '../activity-log';
import { ClientCell, ProductCell } from '../client-cell';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { DescriptionList } from '../description-list';
import { InvoiceTable } from '../invoices/invoice-table';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatusBadge } from '../status-badge';
import { ServiceDialog } from './service-dialog';

export function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['services', id], queryFn: () => adminApi.services.get(id) });
  const s = q.data?.data;
  const [edit, setEdit] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['services'] });
    qc.invalidateQueries({ queryKey: ['services', id, 'log'] });
  };
  const action = useMutation({
    mutationFn: ({ name, body }: { name: string; body?: Record<string, unknown> }) =>
      adminApi.services.action(id, name, body),
    onSuccess: (_res, v) => {
      toast.success(`${v.name} queued`);
      invalidate();
    },
    onError: (e) =>
      toast.error(
        isMissingEndpoint(e) ? 'Provisioning endpoint is not available yet' : errorMessage(e),
      ),
  });
  const loginUrl = useMutation({
    mutationFn: () => adminApi.services.loginUrl(id),
    onSuccess: ({ data }) => window.open(data.url, '_blank', 'noopener'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const server = useQuery({
    queryKey: ['servers', s?.serverId],
    queryFn: () => adminApi.servers.get(s?.serverId as string),
    enabled: Boolean(s?.serverId),
    retry: false,
  });

  return (
    <>
      <AdminPageHeader
        crumbs={[
          { label: 'Services', href: '/admin/services' },
          { label: s?.domain ?? s?.username ?? '…' },
        ]}
        title={s ? (s.domain ?? s.username ?? 'Service') : 'Service'}
        description={s ? <ProductCell id={s.productId} /> : undefined}
        badges={s ? <StatusBadge value={s.status} map={SERVICE_STATUS} /> : null}
        actions={
          s ? (
            <>
              {s.status === 'pending' ? (
                <ConfirmButton
                  title="Provision this service?"
                  description="Runs the module's create action on the assigned server."
                  confirmLabel="Create"
                  onConfirm={() => action.mutateAsync({ name: 'create' })}
                >
                  <PlusCircle /> Create
                </ConfirmButton>
              ) : null}
              {s.status === 'active' ? (
                <ConfirmButton
                  variant="outline"
                  title="Suspend service?"
                  description="The client loses access until unsuspended."
                  confirmLabel="Suspend"
                  destructive
                  onConfirm={() =>
                    action.mutateAsync({ name: 'suspend', body: { reason: 'Suspended by staff' } })
                  }
                >
                  <Pause /> Suspend
                </ConfirmButton>
              ) : null}
              {s.status === 'suspended' ? (
                <ConfirmButton
                  title="Unsuspend service?"
                  confirmLabel="Unsuspend"
                  onConfirm={() => action.mutateAsync({ name: 'unsuspend' })}
                >
                  <Play /> Unsuspend
                </ConfirmButton>
              ) : null}
              {s.status !== 'terminated' && s.status !== 'pending' ? (
                <ConfirmButton
                  variant="outline"
                  title="Terminate service?"
                  description="The account is deleted on the server. This cannot be undone."
                  destructive
                  confirmLabel="Terminate"
                  typeToConfirm={s.domain ?? s.username ?? 'terminate'}
                  onConfirm={() => action.mutateAsync({ name: 'terminate' })}
                >
                  <Trash2 /> Terminate
                </ConfirmButton>
              ) : null}
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            </>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {s ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Billing</CardTitle>
                </CardHeader>
                <CardContent>
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: 'Client', value: <ClientCell id={s.clientId} /> },
                      {
                        label: 'Recurring amount',
                        value: <Money amount={s.recurringAmount} currency={s.currency} />,
                      },
                      { label: 'Billing cycle', value: BILLING_CYCLE_LABELS[s.billingCycle] },
                      { label: 'Registered', value: fmtDate(s.registrationDate) },
                      { label: 'Next due date', value: fmtDate(s.nextDueDate) },
                      {
                        label: 'Server',
                        value:
                          server.data?.data.name ??
                          (s.serverId ? s.serverId.slice(0, 8) : 'Not assigned'),
                      },
                      {
                        label: 'Username',
                        value: s.username ? <span className="font-mono">{s.username}</span> : null,
                      },
                      {
                        label: 'Suspended',
                        value: s.suspendedAt
                          ? `${fmtDateTime(s.suspendedAt)} — ${s.suspendReason ?? ''}`
                          : null,
                      },
                      {
                        label: 'Cancellation requested',
                        value: fmtDateTime(s.cancellationRequestedAt),
                      },
                      { label: 'Notes', value: s.notes, span: true },
                    ]}
                  />
                </CardContent>
              </Card>

              <Tabs defaultValue="log">
                <TabsList variant="line">
                  <TabsTrigger value="log">Provisioning log</TabsTrigger>
                  <TabsTrigger value="invoices">Invoices</TabsTrigger>
                  <TabsTrigger value="data">Module data</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="log" className="mt-4">
                  <ProvisioningLogTable serviceId={id} />
                </TabsContent>
                <TabsContent value="invoices" className="mt-4">
                  <InvoiceTable clientId={s.clientId} />
                </TabsContent>
                <TabsContent value="data" className="mt-4">
                  <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
                    {JSON.stringify(s.moduleData, null, 2)}
                  </pre>
                </TabsContent>
                <TabsContent value="activity" className="mt-4">
                  <ActivityLogTable entityType="service" entityId={id} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Module actions</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setPkgOpen(true)}
                    disabled={s.status === 'terminated'}
                  >
                    <ArrowLeftRight /> Change package
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setPwOpen(true)}
                    disabled={s.status !== 'active'}
                  >
                    <KeyRound /> Change password
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => action.mutate({ name: 'syncUsage' })}
                    disabled={action.isPending}
                  >
                    <RefreshCw /> Sync usage
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => loginUrl.mutate()}
                    disabled={loginUrl.isPending || s.status !== 'active'}
                  >
                    {loginUrl.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />}{' '}
                    Log in to panel
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    Actions run in the worker; results appear in the provisioning log.
                  </p>
                </CardContent>
              </Card>
              <UsageCard serviceId={id} />
            </div>
          </div>
        ) : null}
      </QueryState>
      {edit && s ? (
        <ServiceDialog
          service={s}
          onClose={() => {
            setEdit(false);
            qc.invalidateQueries({ queryKey: ['services', id] });
          }}
        />
      ) : null}
      {pkgOpen && s ? (
        <ChangePackageDialog
          service={s}
          onClose={() => setPkgOpen(false)}
          onSubmit={(productId) =>
            action
              .mutateAsync({ name: 'changePackage', body: { productId } })
              .then(() => setPkgOpen(false))
          }
        />
      ) : null}
      {pwOpen ? (
        <ChangePasswordDialog
          onClose={() => setPwOpen(false)}
          onSubmit={(password) =>
            action
              .mutateAsync({ name: 'changePassword', body: password ? { password } : {} })
              .then(() => setPwOpen(false))
          }
        />
      ) : null}
    </>
  );
}

function UsageCard({ serviceId }: { serviceId: string }) {
  const q = useQuery({
    queryKey: ['services', serviceId, 'usage'],
    queryFn: () => adminApi.services.usage(serviceId),
    retry: false,
  });
  const u = q.data?.data;
  const pct = (used?: number | null, limit?: number | null) =>
    used != null && limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isError || !u ? (
          <p className="text-muted-foreground">
            {q.isPending
              ? 'Loading…'
              : 'No usage data yet. Use “Sync usage” to fetch it from the server.'}
          </p>
        ) : (
          <>
            <UsageRow
              label="Disk"
              used={u.diskUsedMb}
              limit={u.diskLimitMb}
              pct={pct(u.diskUsedMb, u.diskLimitMb)}
            />
            <UsageRow
              label="Bandwidth"
              used={u.bandwidthUsedMb}
              limit={u.bandwidthLimitMb}
              pct={pct(u.bandwidthUsedMb, u.bandwidthLimitMb)}
            />
            {Object.entries(u.extra ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span>{String(v)}</span>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">Synced {fmtDateTime(u.syncedAt)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UsageRow({
  label,
  used,
  limit,
  pct,
}: {
  label: string;
  used?: number | null;
  limit?: number | null;
  pct: number | null;
}) {
  return (
    <div>
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {fmtBytesMb(used ?? undefined)}
          {limit ? ` / ${fmtBytesMb(limit)}` : ''}
        </span>
      </div>
      {pct !== null ? <Progress value={pct} className="mt-1" /> : null}
    </div>
  );
}

export function ProvisioningLogTable({ serviceId }: { serviceId: string }) {
  const q = useQuery({
    queryKey: ['services', serviceId, 'log'],
    queryFn: () => adminApi.services.log(serviceId, { perPage: 50 }),
    refetchInterval: 15_000,
    retry: false,
  });
  const columns: Column<ProvisioningLog>[] = [
    { id: 'when', header: 'When', cell: (l) => fmtDateTime(l.createdAt) },
    {
      id: 'action',
      header: 'Action',
      cell: (l) => <span className="font-mono text-xs">{l.action}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (l) => <StatusBadge value={l.status} map={JOB_STATUS} />,
    },
    {
      id: 'message',
      header: 'Message',
      cell: (l) => (
        <span className="line-clamp-2 max-w-md whitespace-normal text-xs">{l.message ?? '—'}</span>
      ),
    },
    {
      id: 'dur',
      header: 'Duration',
      align: 'right',
      hideBelow: 'md',
      cell: (l) => (l.durationMs != null ? `${l.durationMs} ms` : '—'),
    },
  ];
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch} compact>
      <SimpleTable
        columns={columns}
        rows={q.data?.data ?? []}
        rowKey={(l) => l.id}
        emptyTitle="No provisioning activity yet"
        dense
      />
    </QueryState>
  );
}

function ChangePackageDialog({
  service,
  onClose,
  onSubmit,
}: {
  service: Service;
  onClose: () => void;
  onSubmit: (productId: string) => Promise<unknown>;
}) {
  const products = useQuery({
    queryKey: ['products', 'lookup'],
    queryFn: () => adminApi.lookup.products(),
  });
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change package</DialogTitle>
          <DialogDescription>
            Upgrades/downgrades are prorated to the next due date and the module is told to change
            the plan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>New product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select product" />
            </SelectTrigger>
            <SelectContent>
              {(products.data?.data ?? [])
                .filter((p) => p.id !== service.productId)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!productId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(productId);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Change package
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (password: string) => Promise<unknown>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change panel password</DialogTitle>
          <DialogDescription>
            Leave empty to generate a strong password; the client is emailed either way.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-pw">New password (min. 10 characters)</Label>
          <Input
            id="new-pw"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || (password.length > 0 && password.length < 10)}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(password);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

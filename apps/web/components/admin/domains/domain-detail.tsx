'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  adminUpdateDomainSchema,
  type Domain,
  type DomainContact,
  type DomainSyncLogEntry,
} from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, Lock, Pencil, RefreshCw, RotateCw, Unlock } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
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
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/admin/api';
import { countryName } from '@/lib/admin/countries';
import { applyApiError, errorMessage, isMissingEndpoint } from '@/lib/admin/form-errors';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/admin/format';
import { DOMAIN_STATUS, JOB_STATUS } from '@/lib/admin/status';
import { ActivityLogTable } from '../activity-log';
import { ClientCell } from '../client-cell';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { DescriptionList } from '../description-list';
import {
  DateField,
  FormGrid,
  MoneyField,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from '../form-fields';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatusBadge, ToneBadge } from '../status-badge';

export function DomainDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['domains', id], queryFn: () => adminApi.domains.get(id) });
  const d = q.data?.data;
  const [edit, setEdit] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [nsOpen, setNsOpen] = useState(false);
  const [epp, setEpp] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['domains'] });
  const onErr = (e: unknown) =>
    toast.error(
      isMissingEndpoint(e) ? 'Domain action endpoint is not available yet' : errorMessage(e),
    );
  const sync = useMutation({
    mutationFn: () => adminApi.domains.sync(id),
    onSuccess: () => {
      toast.success('Sync queued');
      invalidate();
    },
    onError: onErr,
  });
  const lock = useMutation({
    mutationFn: (locked: boolean) => adminApi.domains.setLock(id, locked),
    onSuccess: () => {
      toast.success('Lock change queued');
      invalidate();
    },
    onError: onErr,
  });
  const renew = useMutation({
    mutationFn: (years: number) => adminApi.domains.renew(id, { years }),
    onSuccess: () => {
      toast.success('Renewal queued');
      invalidate();
      setRenewOpen(false);
    },
    onError: onErr,
  });
  const register = useMutation({
    mutationFn: () => adminApi.domains.register(id),
    onSuccess: () => {
      toast.success('Registration queued');
      invalidate();
    },
    onError: onErr,
  });
  const getEpp = useMutation({
    mutationFn: () => adminApi.domains.epp(id),
    onSuccess: ({ data }) => setEpp(data.eppCode),
    onError: onErr,
  });
  const ns = useMutation({
    mutationFn: (nameservers: string[]) => adminApi.domains.setNameservers(id, nameservers),
    onSuccess: () => {
      toast.success('Nameserver update queued');
      invalidate();
      setNsOpen(false);
    },
    onError: onErr,
  });

  return (
    <>
      <AdminPageHeader
        crumbs={[{ label: 'Domains', href: '/admin/domains' }, { label: d?.name ?? '…' }]}
        title={d?.name ?? 'Domain'}
        description={d ? `.${d.tld} · ${d.registrarModule ?? 'no registrar'}` : undefined}
        badges={
          d ? (
            <>
              <StatusBadge value={d.status} map={DOMAIN_STATUS} />
              {d.lastError ? <ToneBadge tone="danger">Last action failed</ToneBadge> : null}
            </>
          ) : null
        }
        actions={
          d ? (
            <>
              {d.status === 'pending' ? (
                <ConfirmButton
                  title="Register this domain now?"
                  description="Sends the registration to the registrar."
                  confirmLabel="Register"
                  onConfirm={() => register.mutateAsync()}
                >
                  Register
                </ConfirmButton>
              ) : null}
              <Button variant="outline" onClick={() => setRenewOpen(true)}>
                <RotateCw /> Renew
              </Button>
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw /> Sync
              </Button>
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            </>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: 'Client', value: <ClientCell id={d.clientId} /> },
                      { label: 'Registered', value: fmtDate(d.registrationDate) },
                      { label: 'Expires', value: fmtDate(d.expiryDate) },
                      { label: 'Next due', value: fmtDate(d.nextDueDate) },
                      { label: 'Period', value: `${d.registrationPeriod} year(s)` },
                      {
                        label: 'Renewal price',
                        value: <Money amount={d.recurringAmount} currency={d.currency} />,
                      },
                      { label: 'Auto-renew', value: d.autoRenew ? 'Yes' : 'No' },
                      { label: 'ID protection', value: d.idProtection ? 'Enabled' : 'Off' },
                      { label: 'Registrar status', value: d.registrarStatus },
                      { label: 'Last synced', value: fmtDateTime(d.lastSyncedAt) },
                      {
                        label: 'Last error',
                        value: d.lastError ? (
                          <span className="text-destructive">{d.lastError}</span>
                        ) : null,
                        span: true,
                      },
                      { label: 'Notes', value: d.notes, span: true },
                    ]}
                  />
                </CardContent>
              </Card>

              <Tabs defaultValue="ns">
                <TabsList variant="line">
                  <TabsTrigger value="ns">Nameservers</TabsTrigger>
                  <TabsTrigger value="contacts">Contacts</TabsTrigger>
                  <TabsTrigger value="log">Registrar log</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="ns" className="mt-4">
                  <Card>
                    <CardContent className="space-y-3">
                      {d.nameservers.length ? (
                        <ol className="space-y-1 font-mono text-sm">
                          {d.nameservers.map((n, i) => (
                            <li key={n}>
                              <span className="text-muted-foreground">ns{i + 1}</span> {n}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-muted-foreground text-sm">No nameservers set.</p>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setNsOpen(true)}>
                        <Pencil /> Change nameservers
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="contacts" className="mt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    {(['registrant', 'admin', 'tech', 'billing'] as const).map((k) => {
                      const c = d.contacts?.[k];
                      return (
                        <Card key={k} className="gap-2 py-4">
                          <CardHeader className="px-4">
                            <CardTitle className="text-sm">{titleCase(k)}</CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 text-sm">
                            {c ? (
                              <ContactBlock c={c} />
                            ) : (
                              <span className="text-muted-foreground">
                                Same as registrant / not set
                              </span>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </TabsContent>
                <TabsContent value="log" className="mt-4">
                  <SyncLog domainId={id} />
                </TabsContent>
                <TabsContent value="activity" className="mt-4">
                  <ActivityLogTable entityType="domain" entityId={id} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Registrar actions</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => lock.mutate(!d.locked)}
                    disabled={lock.isPending}
                  >
                    {d.locked ? <Unlock /> : <Lock />}{' '}
                    {d.locked ? 'Unlock transfers' : 'Lock transfers'}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => (epp ? setEpp(null) : getEpp.mutate())}
                    disabled={getEpp.isPending}
                  >
                    {epp ? <EyeOff /> : <Eye />} {epp ? 'Hide EPP code' : 'Show EPP / auth code'}
                  </Button>
                  {epp ? (
                    <code className="select-all break-all rounded bg-muted p-2 text-xs">{epp}</code>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Actions are executed by the worker via the registrar module.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </QueryState>

      {edit && d ? <DomainEditDialog domain={d} onClose={() => setEdit(false)} /> : null}
      {renewOpen && d ? (
        <RenewDialog
          domain={d}
          busy={renew.isPending}
          onClose={() => setRenewOpen(false)}
          onSubmit={(y) => renew.mutate(y)}
        />
      ) : null}
      {nsOpen && d ? (
        <NameserversDialog
          domain={d}
          busy={ns.isPending}
          onClose={() => setNsOpen(false)}
          onSubmit={(list) => ns.mutate(list)}
        />
      ) : null}
    </>
  );
}

function ContactBlock({ c }: { c: DomainContact }) {
  return (
    <address className="not-italic">
      {c.firstName} {c.lastName}
      {c.organization ? `, ${c.organization}` : ''}
      <br />
      {c.address1}
      {c.address2 ? `, ${c.address2}` : ''}
      <br />
      {c.postalCode} {c.city}
      {c.state ? `, ${c.state}` : ''}, {countryName(c.country)}
      <br />
      <span className="text-muted-foreground">
        {c.email} · {c.phone}
      </span>
    </address>
  );
}

function SyncLog({ domainId }: { domainId: string }) {
  const q = useQuery({
    queryKey: ['domains', domainId, 'log'],
    queryFn: () => adminApi.domains.syncLog(domainId, { perPage: 50 }),
    retry: false,
  });
  const columns: Column<DomainSyncLogEntry>[] = [
    { id: 'when', header: 'When', cell: (l) => fmtDateTime(l.createdAt) },
    { id: 'job', header: 'Job', cell: (l) => <span className="font-mono text-xs">{l.job}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: (l) => <StatusBadge value={l.status} map={JOB_STATUS} />,
    },
    { id: 'transition', header: 'Transition', hideBelow: 'md', cell: (l) => l.transition ?? '—' },
    {
      id: 'message',
      header: 'Message',
      cell: (l) => (
        <span className="line-clamp-2 max-w-md whitespace-normal text-xs">{l.message ?? '—'}</span>
      ),
    },
  ];
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch} compact>
      <SimpleTable
        columns={columns}
        rows={q.data?.data ?? []}
        rowKey={(l) => l.id}
        emptyTitle="No registrar activity yet"
        dense
      />
    </QueryState>
  );
}

type EditValues = z.input<typeof adminUpdateDomainSchema>;
function DomainEditDialog({ domain, onClose }: { domain: Domain; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<EditValues>({
    resolver: zodResolver(adminUpdateDomainSchema),
    defaultValues: {
      status: domain.status,
      registrarModule: domain.registrarModule,
      registrationDate: domain.registrationDate,
      expiryDate: domain.expiryDate,
      nextDueDate: domain.nextDueDate,
      registrationPeriod: domain.registrationPeriod,
      recurringAmount: domain.recurringAmount,
      autoRenew: domain.autoRenew,
      idProtection: domain.idProtection,
      notes: domain.notes,
      force: false,
    },
  });
  const m = useMutation({
    mutationFn: (v: EditValues) =>
      adminApi.domains.update(domain.id, adminUpdateDomainSchema.parse(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] });
      toast.success('Domain updated');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {domain.name}</DialogTitle>
          <DialogDescription>
            Local billing data. Registrar-side changes (nameservers, lock, contacts) use the actions
            on the domain page.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormGrid>
              <SelectField
                control={form.control}
                name="status"
                label="Status"
                options={Object.entries(DOMAIN_STATUS).map(([value, v]) => ({
                  value,
                  label: v.label,
                }))}
              />
              <TextField
                control={form.control}
                name="registrarModule"
                label="Registrar module"
                nullable
              />
              <DateField
                control={form.control}
                name="registrationDate"
                label="Registration date"
                nullable
              />
              <DateField control={form.control} name="expiryDate" label="Expiry date" nullable />
              <DateField control={form.control} name="nextDueDate" label="Next due date" nullable />
              <TextField
                control={form.control}
                name="registrationPeriod"
                label="Period (years)"
                type="number"
              />
              <MoneyField
                control={form.control}
                name="recurringAmount"
                label="Renewal price"
                currency={domain.currency}
              />
              <SwitchField control={form.control} name="autoRenew" label="Auto-renew" />
              <SwitchField control={form.control} name="idProtection" label="ID protection" />
              <SwitchField
                control={form.control}
                name="force"
                label="Force status change"
                description="Skip the allowed-transition check."
              />
            </FormGrid>
            <TextareaField control={form.control} name="notes" label="Notes" nullable />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null} Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({
  domain,
  busy,
  onClose,
  onSubmit,
}: {
  domain: Domain;
  busy: boolean;
  onClose: () => void;
  onSubmit: (years: number) => void;
}) {
  const [years, setYears] = useState('1');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew {domain.name}</DialogTitle>
          <DialogDescription>
            An invoice is created for the renewal and the registrar is instructed once it is paid
            (or immediately for staff renewals).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Years</Label>
          <Select value={years} onValueChange={setYears}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 5, 10].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y} year{y > 1 ? 's' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onSubmit(Number(years))}>
            {busy ? <Loader2 className="animate-spin" /> : null} Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameserversDialog({
  domain,
  busy,
  onClose,
  onSubmit,
}: {
  domain: Domain;
  busy: boolean;
  onClose: () => void;
  onSubmit: (ns: string[]) => void;
}) {
  const [list, setList] = useState<string[]>(
    [...domain.nameservers, '', '', '', ''].slice(0, Math.max(4, domain.nameservers.length)),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nameservers for {domain.name}</DialogTitle>
          <DialogDescription>
            At least two nameservers are required by most registries.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {list.map((n, i) => (
            <div key={`ns-${i.toString()}`} className="flex items-center gap-2">
              <Label className="w-10 text-muted-foreground">ns{i + 1}</Label>
              <Input
                value={n}
                onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`ns${i + 1}.example.com`}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setList((l) => [...l, ''])}
            disabled={list.length >= 13}
          >
            Add nameserver
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || list.filter((x) => x.trim()).length < 2}
            onClick={() => onSubmit(list.map((x) => x.trim().toLowerCase()).filter(Boolean))}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Save nameservers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

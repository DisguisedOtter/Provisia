'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createTldSchema, importTldPricingSchema, type TldWithPrices } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError, errorMessage } from '@/lib/admin/form-errors';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { FormGrid, MoneyField, SelectField, SwitchField, TextField } from '../form-fields';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';

export function TldPricing() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tlds'], queryFn: () => adminApi.domains.tlds.list() });
  const [edit, setEdit] = useState<TldWithPrices | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.domains.tlds.remove(id),
    onSuccess: () => {
      toast.success('TLD removed');
      qc.invalidateQueries({ queryKey: ['tlds'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<TldWithPrices>[] = [
    {
      id: 'tld',
      header: 'TLD',
      cell: (t) => (
        <span className="inline-flex items-center gap-2">
          .{t.tld}
          {t.featured ? <Badge variant="outline">Featured</Badge> : null}
          {!t.enabled ? <Badge variant="outline">Disabled</Badge> : null}
        </span>
      ),
    },
    {
      id: 'registrar',
      header: 'Registrar',
      hideBelow: 'md',
      cell: (t) => t.registrarModule ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'register',
      header: 'Register / yr',
      align: 'right',
      cell: (t) => priceFor(t, 'register'),
    },
    { id: 'renew', header: 'Renew / yr', align: 'right', cell: (t) => priceFor(t, 'renew') },
    {
      id: 'transfer',
      header: 'Transfer',
      align: 'right',
      hideBelow: 'sm',
      cell: (t) => priceFor(t, 'transfer'),
    },
    { id: 'years', header: 'Years', hideBelow: 'lg', cell: (t) => `${t.minYears}–${t.maxYears}` },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Edit TLD" onClick={() => setEdit(t)}>
            <Pencil />
          </Button>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            aria-label="Delete TLD"
            title={`Remove .${t.tld}?`}
            destructive
            confirmLabel="Remove"
            onConfirm={() => remove.mutateAsync(t.id)}
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
        title="TLD pricing"
        crumbs={[{ label: 'Domains', href: '/admin/domains' }, { label: 'TLD pricing' }]}
        description="Sell prices per TLD. Import cost prices from a registrar and apply a markup."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Download /> Import from registrar
            </Button>
            <Button onClick={() => setEdit('new')}>
              <Plus /> Add TLD
            </Button>
          </>
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <SimpleTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(t) => t.id}
          emptyTitle="No TLDs configured"
          emptyDescription="Add a TLD manually or import pricing from a registrar module."
          dense
        />
      </QueryState>
      {edit ? <TldDialog tld={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      {importOpen ? <ImportDialog onClose={() => setImportOpen(false)} /> : null}
    </>
  );
}

function priceFor(t: TldWithPrices, key: 'register' | 'renew' | 'transfer') {
  const p = t.prices.find((x) => x.years === 1) ?? t.prices[0];
  if (!p) return <span className="text-muted-foreground">—</span>;
  return <Money amount={p[key]} currency={p.currency} />;
}

type TldValues = z.input<typeof createTldSchema>;
function TldDialog({ tld, onClose }: { tld: TldWithPrices | null; onClose: () => void }) {
  const qc = useQueryClient();
  const registrars = useQuery({
    queryKey: ['modules', 'registrar'],
    queryFn: () => adminApi.modules.registrars(),
    retry: false,
  });
  const year1 = tld?.prices.find((p) => p.years === 1) ?? tld?.prices[0];
  const form = useForm<TldValues>({
    resolver: zodResolver(createTldSchema),
    defaultValues: {
      tld: tld?.tld ?? '',
      registrarModule: tld?.registrarModule ?? null,
      enabled: tld?.enabled ?? true,
      featured: tld?.featured ?? false,
      currency: tld?.currency ?? 'EUR',
      minYears: tld?.minYears ?? 1,
      maxYears: tld?.maxYears ?? 10,
      eppRequired: tld?.eppRequired ?? true,
      idProtectionSupported: tld?.idProtectionSupported ?? false,
      dnsManagementSupported: tld?.dnsManagementSupported ?? false,
      gracePeriodDays: tld?.gracePeriodDays ?? 0,
      redemptionPeriodDays: tld?.redemptionPeriodDays ?? 30,
      redemptionFee: tld?.redemptionFee ?? 0,
      additionalFields: tld?.additionalFields ?? [],
      sortOrder: tld?.sortOrder ?? 0,
      prices: [
        {
          years: 1,
          currency: year1?.currency ?? 'EUR',
          register: year1?.register ?? 0,
          renew: year1?.renew ?? 0,
          transfer: year1?.transfer ?? 0,
        },
      ],
    },
  });
  const m = useMutation({
    mutationFn: (v: TldValues) => {
      const body = createTldSchema.parse(v);
      return tld ? adminApi.domains.tlds.update(tld.id, body) : adminApi.domains.tlds.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tlds'] });
      toast.success('TLD saved');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tld ? `Edit .${tld.tld}` : 'Add TLD'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormGrid>
              <TextField
                control={form.control}
                name="tld"
                label="TLD (without dot)"
                placeholder="nl"
                disabled={Boolean(tld)}
              />
              <SelectField
                control={form.control}
                name="registrarModule"
                label="Registrar"
                nullable
                options={(registrars.data?.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
              <MoneyField
                control={form.control}
                name="prices.0.register"
                label="Register (per year)"
              />
              <MoneyField control={form.control} name="prices.0.renew" label="Renew (per year)" />
              <MoneyField control={form.control} name="prices.0.transfer" label="Transfer" />
              <MoneyField control={form.control} name="redemptionFee" label="Redemption fee" />
              <TextField control={form.control} name="minYears" label="Min years" type="number" />
              <TextField control={form.control} name="maxYears" label="Max years" type="number" />
              <TextField
                control={form.control}
                name="gracePeriodDays"
                label="Grace period (days)"
                type="number"
              />
              <TextField
                control={form.control}
                name="redemptionPeriodDays"
                label="Redemption period (days)"
                type="number"
              />
              <SwitchField control={form.control} name="enabled" label="Enabled" />
              <SwitchField control={form.control} name="featured" label="Featured" />
              <SwitchField
                control={form.control}
                name="eppRequired"
                label="EPP code required for transfer"
              />
              <SwitchField
                control={form.control}
                name="idProtectionSupported"
                label="ID protection supported"
              />
            </FormGrid>
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

type ImportValues = z.input<typeof importTldPricingSchema>;
function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const registrars = useQuery({
    queryKey: ['modules', 'registrar'],
    queryFn: () => adminApi.modules.registrars(),
    retry: false,
  });
  const form = useForm<ImportValues>({
    resolver: zodResolver(importTldPricingSchema),
    defaultValues: {
      registrarModule: '',
      markupPercent: 20,
      createMissing: true,
      overwriteSellPrices: false,
    },
  });
  const m = useMutation({
    mutationFn: (v: ImportValues) => adminApi.domains.tlds.import(importTldPricingSchema.parse(v)),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['tlds'] });
      toast.success(
        'imported' in data
          ? `Imported ${data.imported} TLDs (${data.created} new, ${data.updated} updated)`
          : 'Import queued',
      );
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import TLD pricing</DialogTitle>
          <DialogDescription>
            Fetches cost prices from the registrar and stores sell prices = cost + markup.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <SelectField
              control={form.control}
              name="registrarModule"
              label="Registrar"
              options={(registrars.data?.data ?? []).map((r) => ({
                value: r.id,
                label: `${r.name}${r.configured ? '' : ' (not configured)'}`,
                disabled: !r.configured,
              }))}
              placeholder={registrars.isError ? 'Registrar list unavailable' : 'Select registrar'}
            />
            <TextField control={form.control} name="markupPercent" label="Markup %" type="number" />
            <SwitchField
              control={form.control}
              name="createMissing"
              label="Create TLDs that do not exist yet"
            />
            <SwitchField
              control={form.control}
              name="overwriteSellPrices"
              label="Overwrite existing sell prices"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : <Download />} Import
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

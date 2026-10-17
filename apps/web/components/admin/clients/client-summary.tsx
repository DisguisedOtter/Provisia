'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ClientWithUser, creditAdjustmentSchema } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, BadgeX, Loader2, ShieldCheck } from 'lucide-react';
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
import { adminApi } from '@/lib/admin/api';
import { countryName, EU_COUNTRIES } from '@/lib/admin/countries';
import { applyApiError, errorMessage, isMissingEndpoint } from '@/lib/admin/form-errors';
import { fmtDateTime } from '@/lib/admin/format';
import { DescriptionList } from '../description-list';
import { MoneyField, TextField } from '../form-fields';
import { Money } from '../money';
import { ToneBadge } from '../status-badge';

export function ClientSummary({ client }: { client: ClientWithUser }) {
  const qc = useQueryClient();
  const [creditOpen, setCreditOpen] = useState(false);
  const inEu = EU_COUNTRIES.has(client.country);

  const validate = useMutation({
    mutationFn: () => adminApi.clients.validateVat(client.id),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['clients', client.id] });
      if (data.unavailable) toast.warning('VIES is currently unavailable; try again later.');
      else if (data.valid) toast.success(`VAT number valid${data.name ? `: ${data.name}` : ''}`);
      else toast.error('VAT number is not valid according to VIES');
    },
    onError: (err) =>
      toast.error(
        isMissingEndpoint(err) ? 'VAT validation endpoint is not available yet' : errorMessage(err),
      ),
  });

  const taxKind = !inEu
    ? { label: '0% export (non-EU)', tone: 'info' as const }
    : client.vatValidated
      ? { label: 'Reverse charge (0%)', tone: 'success' as const }
      : client.country === 'NL'
        ? { label: 'NL domestic VAT', tone: 'neutral' as const }
        : { label: 'EU consumer VAT', tone: 'neutral' as const };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Name', value: `${client.firstName} ${client.lastName}` },
              {
                label: 'Email',
                value: (
                  <a className="hover:underline" href={`mailto:${client.email}`}>
                    {client.email}
                  </a>
                ),
              },
              { label: 'Company', value: client.companyName },
              { label: 'Phone', value: client.phone },
              {
                label: 'Address',
                value: (
                  <>
                    {client.address1}
                    {client.address2 ? (
                      <>
                        <br />
                        {client.address2}
                      </>
                    ) : null}
                    <br />
                    {client.postalCode} {client.city}
                    {client.state ? `, ${client.state}` : ''}
                    <br />
                    {countryName(client.country)}
                  </>
                ),
              },
              {
                label: 'Language / currency',
                value: `${client.language.toUpperCase()} · ${client.currency}`,
              },
              { label: 'Client since', value: fmtDateTime(client.createdAt) },
              {
                label: 'Internal notes',
                value: client.notes ? (
                  <span className="whitespace-pre-wrap">{client.notes}</span>
                ) : null,
                span: true,
              },
            ]}
          />
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Credit balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="font-semibold text-3xl tabular-nums">
              <Money amount={client.creditBalance} currency={client.currency} />
            </div>
            <p className="text-muted-foreground text-sm">
              Applied automatically when invoices are issued.
            </p>
            <Button variant="outline" size="sm" onClick={() => setCreditOpen(true)}>
              Adjust credit
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>VAT status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToneBadge tone={taxKind.tone}>{taxKind.label}</ToneBadge>
            {client.vatNumber ? (
              <div className="flex items-center gap-2 text-sm">
                {client.vatValidated ? (
                  <BadgeCheck className="size-4 text-emerald-600" />
                ) : (
                  <BadgeX className="size-4 text-amber-600" />
                )}
                <span className="font-mono">{client.vatNumber}</span>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No VAT number on file.</p>
            )}
            {client.vatValidatedAt ? (
              <p className="text-muted-foreground text-xs">
                Validated {fmtDateTime(client.vatValidatedAt)}
              </p>
            ) : client.vatCheckedAt ? (
              <p className="text-muted-foreground text-xs">
                Last checked {fmtDateTime(client.vatCheckedAt)} (invalid)
              </p>
            ) : null}
            {client.taxExempt ? <ToneBadge tone="info">Tax exempt</ToneBadge> : null}
            {client.vatNumber && inEu ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => validate.mutate()}
                disabled={validate.isPending}
              >
                {validate.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Validate with VIES
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <CreditDialog client={client} open={creditOpen} onOpenChange={setCreditOpen} />
    </div>
  );
}

type CreditValues = z.input<typeof creditAdjustmentSchema>;

function CreditDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientWithUser;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<CreditValues>({
    resolver: zodResolver(creditAdjustmentSchema),
    defaultValues: { amount: 0, description: '' },
  });
  const m = useMutation({
    mutationFn: (v: CreditValues) =>
      adminApi.clients.adjustCredit(client.id, creditAdjustmentSchema.parse(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients', client.id] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Credit balance updated');
      onOpenChange(false);
      form.reset();
    },
    onError: (err) => applyApiError(err, form.setError),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust credit balance</DialogTitle>
          <DialogDescription>
            Positive amounts add credit, negative amounts remove it. A credit transaction is
            recorded.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <MoneyField
              control={form.control}
              name="amount"
              label="Amount"
              currency={client.currency}
            />
            <TextField
              control={form.control}
              name="description"
              label="Description"
              placeholder="e.g. Goodwill credit for outage"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null}
                Apply
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

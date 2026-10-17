'use client';

import { createInvoiceSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/admin/api';
import { EU_COUNTRIES } from '@/lib/admin/countries';
import { errorMessage } from '@/lib/admin/form-errors';
import { addDaysIso, todayIso } from '@/lib/admin/format';
import { ClientPicker } from '../client-picker';
import { AdminPageHeader } from '../page-header';
import { InvoiceLineEditor, type LineDraft, newLine } from './invoice-line-editor';

export function InvoiceNew() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState<string | null>(sp.get('clientId'));
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), 14));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ['clients', clientId],
    queryFn: () => adminApi.clients.get(clientId as string),
    enabled: Boolean(clientId),
  });
  const c = client.data?.data;
  const suggestedRate = !c
    ? '21.00'
    : !EU_COUNTRIES.has(c.country) || c.vatValidated || c.taxExempt
      ? '0.00'
      : c.country === 'NL'
        ? '21.00'
        : '21.00';

  const create = useMutation({
    mutationFn: () => {
      const parsed = createInvoiceSchema.safeParse({
        clientId,
        dueDate,
        notes: notes || null,
        items: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          taxRate: l.taxRate,
          periodStart: l.periodStart || null,
          periodEnd: l.periodEnd || null,
        })),
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(`${first?.path.join('.') ?? 'form'}: ${first?.message ?? 'invalid'}`);
      }
      return adminApi.invoices.create(parsed.data);
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Draft invoice created');
      router.push(`/admin/invoices/${data.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <>
      <AdminPageHeader
        title="New invoice"
        crumbs={[{ label: 'Invoices', href: '/admin/invoices' }, { label: 'New' }]}
        description="Creates a draft. Issue it to assign a number and notify the client."
      />
      <Card>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>Client</Label>
              <ClientPicker value={clientId} onChange={setClientId} />
              {c ? (
                <p className="text-muted-foreground text-xs">
                  {c.country} ·{' '}
                  {c.vatValidated
                    ? 'VAT validated (reverse charge)'
                    : c.vatNumber
                      ? 'VAT number not validated'
                      : 'No VAT number'}{' '}
                  · suggested rate {suggestedRate}%
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <InvoiceLineEditor
            lines={lines}
            onChange={setLines}
            currency={c?.currency ?? 'EUR'}
            defaultTaxRate={suggestedRate}
          />
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (printed on the invoice)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/admin/invoices')}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setError(null);
                create.mutate();
              }}
              disabled={!clientId || create.isPending}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : null} Create draft
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createTransactionSchema } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormItem, FormLabel } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError } from '@/lib/admin/form-errors';
import { TRANSACTION_TYPE } from '@/lib/admin/status';
import { ClientPicker } from '../client-picker';
import { FormGrid, MoneyField, SelectField, TextField } from '../form-fields';

type Values = z.input<typeof createTransactionSchema>;

export function TransactionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      clientId: '',
      invoiceId: null,
      gateway: 'manual',
      gatewayTxnId: null,
      type: 'payment',
      amount: 0,
      fee: 0,
      currency: 'EUR',
      description: null,
    },
  });
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const m = useMutation({
    mutationFn: (v: Values) => adminApi.transactions.create(createTransactionSchema.parse(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Transaction recorded');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record transaction</DialogTitle>
          <DialogDescription>
            Manual bookkeeping entry. To settle an invoice use “Mark paid” on the invoice instead.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormItem>
              <FormLabel>Client</FormLabel>
              <ClientPicker
                value={clientId}
                onChange={(id) => form.setValue('clientId', id ?? '', { shouldValidate: true })}
              />
            </FormItem>
            <FormGrid>
              <SelectField
                control={form.control}
                name="type"
                label="Type"
                options={Object.entries(TRANSACTION_TYPE).map(([value, v]) => ({
                  value,
                  label: v.label,
                }))}
              />
              <TextField control={form.control} name="gateway" label="Gateway / method" />
              <MoneyField control={form.control} name="amount" label="Amount" />
              <MoneyField control={form.control} name="fee" label="Fee" />
              <TextField control={form.control} name="gatewayTxnId" label="Reference" nullable />
              <TextField control={form.control} name="description" label="Description" nullable />
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null} Record
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

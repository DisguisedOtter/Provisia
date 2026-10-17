'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createServiceSchema, type Service, updateServiceSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
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
import { BILLING_CYCLE_LABELS, BILLING_CYCLES, todayIso } from '@/lib/admin/format';
import { SERVICE_STATUS } from '@/lib/admin/status';
import { ClientPicker } from '../client-picker';
import {
  DateField,
  FormGrid,
  MoneyField,
  SelectField,
  TextareaField,
  TextField,
} from '../form-fields';

type CreateValues = z.input<typeof createServiceSchema> & { status?: Service['status'] };

export function ServiceDialog({
  service,
  clientId,
  onClose,
}: {
  service?: Service;
  clientId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: ['products', 'lookup'],
    queryFn: () => adminApi.lookup.products(),
  });
  const servers = useQuery({
    queryKey: ['servers', 'lookup'],
    queryFn: () => adminApi.lookup.servers(),
    retry: false,
  });
  const editing = Boolean(service);

  const form = useForm<CreateValues>({
    resolver: zodResolver(editing ? updateServiceSchema : createServiceSchema) as never,
    defaultValues: service
      ? {
          clientId: service.clientId,
          productId: service.productId,
          serverId: service.serverId,
          billingCycle: service.billingCycle,
          recurringAmount: service.recurringAmount,
          currency: service.currency,
          registrationDate: service.registrationDate,
          nextDueDate: service.nextDueDate,
          domain: service.domain,
          username: service.username,
          notes: service.notes,
          status: service.status,
        }
      : {
          clientId: clientId ?? '',
          productId: '',
          serverId: null,
          billingCycle: 'monthly',
          recurringAmount: 0,
          currency: 'EUR',
          registrationDate: todayIso(),
          nextDueDate: todayIso(),
          domain: null,
          username: null,
          notes: null,
        },
  });

  const productId = useWatch({ control: form.control, name: 'productId' });
  const clientValue = useWatch({ control: form.control, name: 'clientId' });
  const cycle = useWatch({ control: form.control, name: 'billingCycle' });
  const product = products.data?.data.find((p) => p.id === productId);

  // Prefill the amount from the product price for the selected cycle (create only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to product/cycle only
  useEffect(() => {
    if (editing || !product) return;
    const price = product.prices.find((p) => p.billingCycle === cycle) ?? product.prices[0];
    if (price) {
      form.setValue('recurringAmount', price.recurring);
      if (price.billingCycle !== cycle) form.setValue('billingCycle', price.billingCycle);
    }
  }, [productId, cycle, product]);

  const m = useMutation({
    mutationFn: (v: CreateValues) =>
      service
        ? adminApi.services.update(service.id, updateServiceSchema.parse(v))
        : adminApi.services.create(createServiceSchema.parse(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      toast.success(service ? 'Service updated' : 'Service created');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });

  const availableCycles = product?.prices.length
    ? product.prices.map((p) => p.billingCycle)
    : BILLING_CYCLES;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service ? 'Edit service' : 'New service'}</DialogTitle>
          <DialogDescription>
            {service
              ? 'Billing details and status. Module actions are on the service page.'
              : 'Manually add a service for a client without an order. Provisioning can be triggered afterwards.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            {!editing ? (
              <FormGrid>
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <ClientPicker
                    value={clientValue}
                    onChange={(id) => form.setValue('clientId', id ?? '', { shouldValidate: true })}
                    disabled={Boolean(clientId)}
                  />
                  {form.formState.errors.clientId ? (
                    <p className="text-destructive text-sm">Client is required</p>
                  ) : null}
                </FormItem>
                <SelectField
                  control={form.control}
                  name="productId"
                  label="Product"
                  options={(products.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                  placeholder={products.isPending ? 'Loading…' : 'Select product'}
                />
              </FormGrid>
            ) : null}
            <FormGrid>
              <SelectField
                control={form.control}
                name="billingCycle"
                label="Billing cycle"
                options={availableCycles.map((c) => ({ value: c, label: BILLING_CYCLE_LABELS[c] }))}
              />
              <MoneyField
                control={form.control}
                name="recurringAmount"
                label="Recurring amount (excl. VAT)"
              />
              <DateField control={form.control} name="registrationDate" label="Registration date" />
              <DateField control={form.control} name="nextDueDate" label="Next due date" nullable />
              <TextField control={form.control} name="domain" label="Domain / hostname" nullable />
              <TextField control={form.control} name="username" label="Username" nullable />
              <SelectField
                control={form.control}
                name="serverId"
                label="Server"
                nullable
                options={(servers.data?.data ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.module})`,
                }))}
              />
              {editing ? (
                <SelectField
                  control={form.control}
                  name="status"
                  label="Status"
                  options={Object.entries(SERVICE_STATUS).map(([value, v]) => ({
                    value,
                    label: v.label,
                  }))}
                  description="Changing status here does not call the module."
                />
              ) : null}
            </FormGrid>
            <TextareaField control={form.control} name="notes" label="Admin notes" nullable />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null}
                {service ? 'Save' : 'Create service'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

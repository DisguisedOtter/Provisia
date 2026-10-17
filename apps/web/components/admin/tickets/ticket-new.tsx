'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createTicketSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Form, FormItem, FormLabel } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError } from '@/lib/admin/form-errors';
import { TICKET_PRIORITY } from '@/lib/admin/status';
import { ClientPicker } from '../client-picker';
import { FormGrid, SelectField, TextareaField, TextField } from '../form-fields';
import { AdminPageHeader } from '../page-header';

type Values = z.input<typeof createTicketSchema>;

export function TicketNew() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const deps = useQuery({
    queryKey: ['ticket-departments'],
    queryFn: () => adminApi.lookup.departments(),
  });
  const staff = useQuery({
    queryKey: ['staff', 'lookup'],
    queryFn: () => adminApi.lookup.staff(),
    retry: false,
  });
  const form = useForm<Values>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      departmentId: '',
      subject: '',
      body: '',
      priority: 'medium',
      clientId: sp.get('clientId') ?? undefined,
      requesterEmail: undefined,
      requesterName: undefined,
      cc: [],
      attachmentIds: [],
      assignedToUserId: null,
    },
  });
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = createTicketSchema.parse({
        ...v,
        clientId: v.clientId || undefined,
        requesterEmail: v.requesterEmail || undefined,
        requesterName: v.requesterName || undefined,
      });
      return adminApi.tickets.create(body);
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Ticket opened');
      router.push(`/admin/tickets/${data.id}`);
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <>
      <AdminPageHeader
        title="New ticket"
        crumbs={[{ label: 'Tickets', href: '/admin/tickets' }, { label: 'New' }]}
        description="Open a ticket on behalf of a client or an external requester."
      />
      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
              <FormGrid>
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <ClientPicker
                    value={clientId}
                    onChange={(id) => form.setValue('clientId', id ?? undefined)}
                  />
                </FormItem>
                <SelectField
                  control={form.control}
                  name="departmentId"
                  label="Department"
                  options={(deps.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                  placeholder={deps.isPending ? 'Loading…' : 'Select department'}
                />
                {!clientId ? (
                  <>
                    <TextField
                      control={form.control}
                      name="requesterName"
                      label="Requester name"
                      nullable
                    />
                    <TextField
                      control={form.control}
                      name="requesterEmail"
                      label="Requester email"
                      type="email"
                      nullable
                    />
                  </>
                ) : null}
                <SelectField
                  control={form.control}
                  name="priority"
                  label="Priority"
                  options={Object.entries(TICKET_PRIORITY).map(([value, v]) => ({
                    value,
                    label: v.label,
                  }))}
                />
                <SelectField
                  control={form.control}
                  name="assignedToUserId"
                  label="Assign to"
                  nullable
                  options={(staff.data?.data ?? []).map((u) => ({
                    value: u.id,
                    label: `${u.firstName} ${u.lastName}`.trim() || u.email,
                  }))}
                />
                <TextField
                  control={form.control}
                  name="subject"
                  label="Subject"
                  className="sm:col-span-2"
                />
                <TextareaField
                  control={form.control}
                  name="body"
                  label="Message"
                  rows={8}
                  className="sm:col-span-2"
                  description="Markdown supported. The client receives this as the first reply."
                />
              </FormGrid>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/admin/tickets')}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={m.isPending}>
                  {m.isPending ? <Loader2 className="animate-spin" /> : null} Open ticket
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}

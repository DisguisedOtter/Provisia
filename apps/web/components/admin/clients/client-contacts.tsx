'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ClientContact, createClientContactSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError, errorMessage } from '@/lib/admin/form-errors';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { CheckboxField, FormGrid, TextField } from '../form-fields';
import { QueryState } from '../query-state';

type Values = z.input<typeof createClientContactSchema>;
const PERMS = ['services', 'domains', 'invoices', 'tickets', 'profile'] as const;

export function ClientContacts({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['clients', clientId, 'contacts'],
    queryFn: () => adminApi.clients.contacts.list(clientId),
  });
  const [editing, setEditing] = useState<ClientContact | null | 'new'>(null);
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.clients.contacts.remove(clientId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients', clientId, 'contacts'] });
      toast.success('Contact removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<ClientContact>[] = [
    { id: 'name', header: 'Name', cell: (c) => `${c.firstName} ${c.lastName}` },
    { id: 'email', header: 'Email', cell: (c) => c.email },
    { id: 'phone', header: 'Phone', hideBelow: 'md', cell: (c) => c.phone ?? '—' },
    {
      id: 'perms',
      header: 'Access',
      hideBelow: 'lg',
      cell: (c) =>
        PERMS.filter((p) => c.permissions[p]).join(', ') || (
          <span className="text-muted-foreground">none</span>
        ),
    },
    {
      id: 'emails',
      header: 'Emails',
      hideBelow: 'lg',
      cell: (c) =>
        [c.receivesInvoiceEmails && 'invoices', c.receivesSupportEmails && 'support']
          .filter(Boolean)
          .join(', ') || '—',
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit contact"
            onClick={() => setEditing(c)}
          >
            <Pencil />
          </Button>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            aria-label="Remove contact"
            title="Remove contact?"
            description={`${c.firstName} ${c.lastName} will lose portal access.`}
            destructive
            confirmLabel="Remove"
            onConfirm={() => remove.mutateAsync(c.id)}
          >
            <Trash2 />
          </ConfirmButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> Add contact
        </Button>
      </div>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch} compact>
        <SimpleTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(c) => c.id}
          emptyTitle="No contacts"
          emptyDescription="Sub-users who can access parts of the portal on behalf of this client."
        />
      </QueryState>
      {editing ? (
        <ContactDialog
          clientId={clientId}
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ContactDialog({
  clientId,
  contact,
  onClose,
}: {
  clientId: string;
  contact: ClientContact | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(createClientContactSchema),
    defaultValues: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          permissions: contact.permissions,
          receivesInvoiceEmails: contact.receivesInvoiceEmails,
          receivesSupportEmails: contact.receivesSupportEmails,
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: null,
          permissions: {
            services: true,
            domains: true,
            invoices: false,
            tickets: true,
            profile: false,
          },
          receivesInvoiceEmails: false,
          receivesSupportEmails: true,
        },
  });
  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = createClientContactSchema.parse(v);
      return contact
        ? adminApi.clients.contacts.update(clientId, contact.id, body)
        : adminApi.clients.contacts.create(clientId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients', clientId, 'contacts'] });
      toast.success(contact ? 'Contact updated' : 'Contact added');
      onClose();
    },
    onError: (err) => applyApiError(err, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormGrid>
              <TextField control={form.control} name="firstName" label="First name" />
              <TextField control={form.control} name="lastName" label="Last name" />
              <TextField control={form.control} name="email" label="Email" type="email" />
              <TextField control={form.control} name="phone" label="Phone" nullable />
            </FormGrid>
            <fieldset className="space-y-2">
              <legend className="font-medium text-sm">Portal access</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PERMS.map((p) => (
                  <CheckboxField
                    key={p}
                    control={form.control}
                    name={`permissions.${p}`}
                    label={p.charAt(0).toUpperCase() + p.slice(1)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium text-sm">Email notifications</legend>
              <div className="grid grid-cols-2 gap-2">
                <CheckboxField
                  control={form.control}
                  name="receivesInvoiceEmails"
                  label="Invoices"
                />
                <CheckboxField
                  control={form.control}
                  name="receivesSupportEmails"
                  label="Support"
                />
              </div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ClientContact, emailSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { ConfirmDialog } from '../../confirm-dialog';
import { EmptyState } from '../../empty-state';
import { QueryState } from '../../query-state';
import { ListSkeleton } from '../../skeletons';

const PERMS = ['services', 'domains', 'invoices', 'tickets', 'profile'] as const;

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: emailSchema,
  phone: z.string().max(40),
  password: z
    .string()
    .max(200)
    .refine((v) => v === '' || v.length >= 10, 'Use at least 10 characters'),
  permissions: z.object({
    services: z.boolean(),
    domains: z.boolean(),
    invoices: z.boolean(),
    tickets: z.boolean(),
    profile: z.boolean(),
  }),
  receivesInvoiceEmails: z.boolean(),
  receivesSupportEmails: z.boolean(),
});
type Values = z.infer<typeof schema>;

function ContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: ClientContact | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone ?? '',
          password: '',
          permissions: contact.permissions,
          receivesInvoiceEmails: contact.receivesInvoiceEmails,
          receivesSupportEmails: contact.receivesSupportEmails,
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          password: '',
          permissions: {
            services: false,
            domains: false,
            invoices: false,
            tickets: true,
            profile: false,
          },
          receivesInvoiceEmails: false,
          receivesSupportEmails: false,
        },
  });
  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = { ...v, phone: v.phone || null, password: v.password || undefined };
      return contact
        ? portalApi.account.contacts.update(contact.id, body)
        : portalApi.account.contacts.create(body);
    },
    onSuccess: () => {
      toast.success(t('account.contactSaved'));
      qc.invalidateQueries({ queryKey: portalKeys.contacts });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? t('account.editContact') : t('account.addContact')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('account.firstName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('account.lastName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('common.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('common.phone')}</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="sm:col-span-2">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('account.contactPassword')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-sm">{t('account.permissions')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMS.map((p) => (
                  <FormField
                    key={p}
                    control={form.control}
                    name={`permissions.${p}`}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(Boolean(v))}
                        />{' '}
                        {t(`account.perm.${p}`)}
                      </label>
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="receivesInvoiceEmails"
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                    />{' '}
                    {t('account.receivesInvoiceEmails')}
                  </label>
                )}
              />
              <FormField
                control={form.control}
                name="receivesSupportEmails"
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                    />{' '}
                    {t('account.receivesSupportEmails')}
                  </label>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ClientContact | null | 'new'>(null);
  const [removing, setRemoving] = useState<ClientContact | null>(null);
  const query = useQuery({
    queryKey: portalKeys.contacts,
    queryFn: async () => (await portalApi.account.contacts.list()).data,
  });
  const remove = useMutation({
    mutationFn: (id: string) => portalApi.account.contacts.remove(id),
    onSuccess: () => {
      toast.success(t('account.contactRemoved'));
      qc.invalidateQueries({ queryKey: portalKeys.contacts });
      setRemoving(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{t('account.contacts')}</h2>
          <p className="text-muted-foreground text-sm">{t('account.contactsHint')}</p>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('account.addContact')}
        </Button>
      </div>
      <QueryState
        query={query}
        skeleton={<ListSkeleton rows={3} />}
        empty={
          <EmptyState
            icon={Users}
            title={t('account.contactsEmpty')}
            action={<Button onClick={() => setEditing('new')}>{t('account.addContact')}</Button>}
          />
        }
      >
        {(contacts) => (
          <Card className="divide-y p-0">
            {contacts.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">
                    {c.firstName} {c.lastName}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {c.email}
                    {c.userId ? ' · login' : ''} ·{' '}
                    {PERMS.filter((p) => c.permissions[p])
                      .map((p) => t(`account.perm.${p}`))
                      .join(', ') || t('common.none')}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(c)}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </QueryState>
      {editing !== null ? (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('account.contactRemoveConfirm')}
        destructive
        confirmLabel={t('common.remove')}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { fmtDate } from '@/lib/portal/format';
import { portalKeys, useClientProfile } from '@/lib/portal/hooks';
import { LOCALE_NAMES, useI18n } from '@/lib/portal/i18n';
import type { Client } from '@/lib/portal/types';
import { QueryState } from '../../query-state';
import { FormSkeleton } from '../../skeletons';

const schema = z.object({
  companyName: z.string().max(200),
  vatNumber: z.string().max(32),
  address1: z.string().max(200),
  address2: z.string().max(200),
  city: z.string().max(100),
  postalCode: z.string().max(20),
  state: z.string().max(100),
  country: z.string().length(2).toUpperCase(),
  phone: z.string().max(40),
  language: z.string().max(10),
});
type Values = z.infer<typeof schema>;

function toValues(c: Client): Values {
  return {
    companyName: c.companyName ?? '',
    vatNumber: c.vatNumber ?? '',
    address1: c.address1,
    address2: c.address2 ?? '',
    city: c.city,
    postalCode: c.postalCode,
    state: c.state ?? '',
    country: c.country,
    phone: c.phone ?? '',
    language: c.language,
  };
}

function ProfileForm({ client }: { client: Client }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(client) });
  useEffect(() => form.reset(toValues(client)), [client, form]);
  const save = useMutation({
    mutationFn: (v: Values) =>
      portalApi.account.update({
        ...v,
        companyName: v.companyName || null,
        vatNumber: v.vatNumber || null,
        address2: v.address2 || null,
        state: v.state || null,
        phone: v.phone || null,
      }),
    onSuccess: ({ data }) => {
      qc.setQueryData(portalKeys.account, data);
      toast.success(t('account.profileSaved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const vies = useMutation({
    mutationFn: () => portalApi.account.validateVat(),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: portalKeys.account });
      if (data.unavailable) toast.warning(t('account.vatUnavailable'));
      else if (data.valid) toast.success(t('account.vatValid', { name: data.name ?? '' }));
      else toast.error(t('account.vatInvalid'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const field = (
    name: keyof Values,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...props} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const vatDirty = form.watch('vatNumber') !== (client.vatNumber ?? '');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('account.company')}</CardTitle>
            <CardDescription>{t('account.companyHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {field('companyName', t('account.companyName'))}
            <div className="space-y-2">
              {field('vatNumber', t('account.vatNumber'), {
                placeholder: 'NL123456789B01',
                className: 'uppercase',
              })}
              {client.vatNumber ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {client.vatValidated ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <BadgeCheck className="size-3.5" />{' '}
                      {t('account.vatValidated', { date: fmtDate(client.vatValidatedAt, locale) })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="size-3.5" /> {t('account.vatNotValidated')}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={vies.isPending || vatDirty}
                    onClick={() => vies.mutate()}
                  >
                    {vies.isPending ? t('common.loading') : t('account.vatValidate')}
                  </Button>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('account.address')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field('address1', t('domains.address1'))}</div>
            <div className="sm:col-span-2">
              {field('address2', `${t('domains.address2')} (${t('common.optional')})`)}
            </div>
            {field('postalCode', t('domains.postalCode'))}
            {field('city', t('domains.city'))}
            {field('state', `${t('domains.state')} (${t('common.optional')})`)}
            {field('country', t('domains.country'), { maxLength: 2, className: 'uppercase' })}
            {field('phone', t('common.phone'), { type: 'tel' })}
            <FormField
              control={form.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('account.language')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(LOCALE_NAMES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function ProfileView() {
  const profile = useClientProfile();
  return (
    <QueryState query={profile} skeleton={<FormSkeleton fields={6} />} kind="item">
      {(c) => <ProfileForm client={c} />}
    </QueryState>
  );
}

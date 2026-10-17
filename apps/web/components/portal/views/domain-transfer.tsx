'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { domainNameSchema } from '@provisia/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ApiError } from '@/lib/api';
import { portalApi, publicApi } from '@/lib/portal/api';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { useMoney } from '../money';
import { PageHeader } from '../page-header';

export function DomainTransferView() {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useMoney();
  const [checked, setChecked] = useState<{
    domain: string;
    eligible: boolean;
    price?: { amount: number; currency: string } | null;
    reason?: string;
  } | null>(null);
  const schema = z.object({
    domain: domainNameSchema,
    eppCode: z.string().min(1, t('val.required')).max(255),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { domain: '', eppCode: '' },
  });
  const tlds = useQuery({
    queryKey: portalKeys.tlds,
    queryFn: async () => (await publicApi.domains.tlds()).data,
    staleTime: 10 * 60_000,
  });

  const check = useMutation({
    mutationFn: async (domain: string) => {
      const res = await publicApi.domains.check({ domain, limit: 1 });
      const r = res.data.requested;
      const tld = tlds.data?.find((x) => domain.endsWith(`.${x.tld}`));
      const price = tld?.prices.find((p) => p.years === 1) ?? tld?.prices[0];
      return {
        domain,
        eligible: Boolean(r && r.status === 'taken' && tld),
        price: price ? { amount: price.transfer, currency: price.currency } : null,
        reason: !tld
          ? 'TLD not supported'
          : r?.status === 'available'
            ? 'domain is not registered'
            : r?.reason,
      };
    },
    onSuccess: (r) => setChecked(r),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  const submit = useMutation({
    mutationFn: (v: Values) =>
      portalApi.orders.create({
        items: [
          {
            type: 'domain_transfer',
            domainName: v.domain,
            billingCycle: 'annually',
            quantity: 1,
            config: { eppCode: v.eppCode, years: 1 },
          },
        ],
      }),
    onSuccess: ({ data }) => {
      toast.success(t('domains.transferStarted'));
      router.push(data.invoiceId ? `/portal/invoices/${data.invoiceId}?pay=1` : '/portal/domains');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  const domain = form.watch('domain');

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        back={{ href: '/portal/domains', label: t('domains.title') }}
        title={t('domains.transferTitle')}
        description={t('domains.transferDescription')}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('domains.transferDomain')}</CardTitle>
          <CardDescription>{t('domains.eppHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="domain"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('domains.transferDomain')}</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="example.nl"
                          autoCapitalize="none"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            setChecked(null);
                          }}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!domain || check.isPending}
                        onClick={async () => {
                          const ok = await form.trigger('domain');
                          if (ok) check.mutate(form.getValues('domain').toLowerCase());
                        }}
                      >
                        {check.isPending ? t('common.loading') : t('domains.transferCheck')}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {checked ? (
                <Alert variant={checked.eligible ? 'default' : 'destructive'}>
                  <AlertTitle>
                    {checked.eligible
                      ? t('domains.transferEligible', {
                          domain: checked.domain,
                          price: checked.price
                            ? fmt(checked.price.amount, checked.price.currency)
                            : '—',
                        })
                      : t('domains.transferNotEligible', {
                          domain: checked.domain,
                          reason: checked.reason ?? '—',
                        })}
                  </AlertTitle>
                  {checked.eligible ? (
                    <AlertDescription>{t('cart.estimateUnavailable')}</AlertDescription>
                  ) : null}
                </Alert>
              ) : null}
              <FormField
                control={form.control}
                name="eppCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('domains.transferEpp')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" autoCapitalize="none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={submit.isPending || (checked !== null && !checked.eligible)}
                >
                  {submit.isPending ? t('common.submitting') : t('domains.transferSubmit')}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

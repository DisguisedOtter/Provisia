'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { portalApi } from '@/lib/portal/api';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';

type Outcome = 'checking' | 'success' | 'pending' | 'failed';
const POLL_MS = 3000;
const MAX_POLLS = 20;

/**
 * Landing page after a gateway redirect or Stripe confirmation. The gateway's query params only give a
 * hint; the truth is the invoice status, which the webhook updates — so we poll it for about a minute.
 */
export function PaymentReturnView({ invoiceId }: { invoiceId: string }) {
  const { t } = useI18n();
  const params = useSearchParams();
  const hint = params.get('redirect_status') ?? params.get('status') ?? '';
  const failedHint = ['failed', 'canceled', 'cancelled', 'expired'].includes(hint);
  const [polls, setPolls] = useState(0);
  const invoice = useQuery({
    queryKey: portalKeys.invoice(invoiceId),
    queryFn: async () => (await portalApi.invoices.get(invoiceId)).data,
    refetchInterval: (q) =>
      q.state.data?.status === 'paid' || polls >= MAX_POLLS || failedHint ? false : POLL_MS,
  });
  useEffect(() => {
    if (invoice.dataUpdatedAt) setPolls((p) => p + 1);
  }, [invoice.dataUpdatedAt]);

  const outcome: Outcome =
    invoice.data?.status === 'paid'
      ? 'success'
      : failedHint
        ? 'failed'
        : invoice.isError || polls >= MAX_POLLS
          ? 'pending'
          : invoice.isPending
            ? 'checking'
            : 'checking';

  const view = {
    checking: {
      icon: Clock,
      title: t('pay.return.checking'),
      hint: '',
      tone: 'text-muted-foreground',
    },
    success: {
      icon: CheckCircle2,
      title: t('pay.return.success'),
      hint: t('pay.return.successHint', { number: invoice.data?.number ?? '' }),
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    pending: {
      icon: Clock,
      title: t('pay.return.pending'),
      hint: t('pay.return.pendingHint'),
      tone: 'text-amber-600 dark:text-amber-400',
    },
    failed: {
      icon: XCircle,
      title: t('pay.return.failed'),
      hint: t('pay.return.failedHint'),
      tone: 'text-red-600 dark:text-red-400',
    },
  }[outcome];
  const Icon = view.icon;

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardContent className="flex flex-col items-center p-8 text-center">
          <Icon
            className={`mb-4 size-12 ${view.tone} ${outcome === 'checking' ? 'animate-pulse' : ''}`}
          />
          <h1 className="font-semibold text-xl">{view.title}</h1>
          {outcome === 'checking' ? (
            <Skeleton className="mt-3 h-4 w-48" />
          ) : (
            <p className="mt-2 text-muted-foreground text-sm">{view.hint}</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {outcome === 'failed' ? (
              <Button asChild>
                <Link href={`/portal/invoices/${invoiceId}?pay=1`}>{t('pay.return.tryAgain')}</Link>
              </Button>
            ) : null}
            <Button variant={outcome === 'failed' ? 'outline' : 'default'} asChild>
              <Link href={`/portal/invoices/${invoiceId}`}>{t('pay.return.backToInvoice')}</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/portal">{t('pay.return.toDashboard')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

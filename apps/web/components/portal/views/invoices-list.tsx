'use client';

import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { portalApi } from '@/lib/portal/api';
import { daysUntil, fmtDate } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../empty-state';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { QueryState } from '../query-state';
import { ListSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

export function InvoicesListView() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? 'all';
  const q = { page, perPage: 25, status: status === 'all' ? undefined : status };
  const query = useQuery({
    queryKey: portalKeys.invoices(q),
    queryFn: () => portalApi.invoices.list(q),
  });
  const go = (next: { page?: number; status?: string }) => {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== 'all') sp.set('status', s);
    if ((next.page ?? 1) > 1) sp.set('page', String(next.page));
    router.push(`/portal/invoices${sp.size ? `?${sp}` : ''}`);
  };

  return (
    <div>
      <PageHeader title={t('invoices.title')} description={t('invoices.description')}>
        <Tabs value={status} onValueChange={(v) => go({ status: v, page: 1 })}>
          <TabsList>
            <TabsTrigger value="all">{t('invoices.filter.all')}</TabsTrigger>
            <TabsTrigger value="unpaid">{t('invoices.filter.unpaid')}</TabsTrigger>
            <TabsTrigger value="paid">{t('invoices.filter.paid')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>
      <QueryState
        query={query}
        skeleton={<ListSkeleton />}
        empty={
          <EmptyState
            icon={Receipt}
            title={t('invoices.empty')}
            description={t('invoices.emptyHint')}
          />
        }
      >
        {({ data, meta }) => (
          <>
            <Card className="divide-y p-0">
              {data.map((inv) => {
                const overdue = inv.status === 'unpaid' && (daysUntil(inv.dueDate) ?? 0) < 0;
                return (
                  <div
                    key={inv.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/portal/invoices/${inv.id}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {inv.number ?? t('status.draft')}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {t('invoices.issued')}: {fmtDate(inv.issueDate, locale)} ·{' '}
                        {t('invoices.due')}: {fmtDate(inv.dueDate, locale)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end">
                      <Money
                        amount={inv.total}
                        currency={inv.currency}
                        className="font-medium text-sm"
                      />
                      <StatusBadge status={overdue ? 'overdue' : inv.status} />
                      {inv.status === 'unpaid' || inv.status === 'collections' ? (
                        <Button size="sm" asChild>
                          <Link href={`/portal/invoices/${inv.id}?pay=1`}>{t('dash.pay')}</Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/portal/invoices/${inv.id}`}>{t('common.view')}</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
            <Pagination meta={meta} onPage={(p) => go({ page: p })} />
          </>
        )}
      </QueryState>
    </div>
  );
}

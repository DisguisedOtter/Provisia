'use client';

import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { portalApi } from '@/lib/portal/api';
import type { DictKey } from '@/lib/portal/dictionary';
import { fmtDate } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../empty-state';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { QueryState } from '../query-state';
import { ListSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

export function ServicesListView() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const page = Number(params.get('page') ?? 1);
  const query = useQuery({
    queryKey: portalKeys.services({ page }),
    queryFn: () => portalApi.services.list({ page, perPage: 25 }),
  });

  return (
    <div>
      <PageHeader title={t('services.title')} description={t('services.description')}>
        <Button asChild size="sm">
          <Link href="/order">{t('dash.orderNew')}</Link>
        </Button>
      </PageHeader>
      <QueryState
        query={query}
        skeleton={<ListSkeleton />}
        empty={
          <EmptyState
            icon={Server}
            title={t('services.empty')}
            description={t('services.emptyHint')}
            action={
              <Button asChild>
                <Link href="/order">{t('dash.orderNew')}</Link>
              </Button>
            }
          />
        }
      >
        {({ data, meta }) => (
          <>
            <Card className="divide-y p-0">
              {data.map((s) => (
                <Link
                  key={s.id}
                  href={`/portal/services/${s.id}`}
                  className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">
                      {s.product?.name ?? t('services.product')}
                    </div>
                    <div className="truncate text-muted-foreground text-xs">
                      {s.domain ?? s.username ?? s.id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm sm:w-80 sm:justify-end">
                    <div className="hidden text-muted-foreground text-xs sm:block">
                      {t('services.nextDue')}: {fmtDate(s.nextDueDate, locale)}
                    </div>
                    <div className="tabular-nums">
                      <Money amount={s.recurringAmount} currency={s.currency} />
                      <span className="text-muted-foreground text-xs">
                        {' '}
                        / {t(`cycle.short.${s.billingCycle}` as DictKey)}
                      </span>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
              ))}
            </Card>
            <Pagination meta={meta} onPage={(p) => router.push(`/portal/services?page=${p}`)} />
          </>
        )}
      </QueryState>
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Globe, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { portalApi } from '@/lib/portal/api';
import { daysUntil, fmtDate } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';
import { EmptyState } from '../empty-state';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { QueryState } from '../query-state';
import { ListSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

export function DomainsListView() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const page = Number(params.get('page') ?? 1);
  const query = useQuery({
    queryKey: portalKeys.domains({ page }),
    queryFn: () => portalApi.domains.list({ page, perPage: 25 }),
  });

  return (
    <div>
      <PageHeader title={t('domains.title')} description={t('domains.description')}>
        <Button asChild size="sm" variant="outline">
          <Link href="/portal/domains/transfer">
            <ArrowRightLeft className="size-4" /> {t('domains.transferIn')}
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/domain-search">
            <Plus className="size-4" /> {t('domains.register')}
          </Link>
        </Button>
      </PageHeader>
      <QueryState
        query={query}
        skeleton={<ListSkeleton />}
        empty={
          <EmptyState
            icon={Globe}
            title={t('domains.empty')}
            description={t('domains.emptyHint')}
            action={
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link href="/portal/domains/transfer">{t('domains.transferIn')}</Link>
                </Button>
                <Button asChild>
                  <Link href="/domain-search">{t('domains.register')}</Link>
                </Button>
              </div>
            }
          />
        }
      >
        {({ data, meta }) => (
          <>
            <Card className="divide-y p-0">
              {data.map((d) => {
                const days = daysUntil(d.expiryDate);
                const soon = days !== null && days <= 30;
                return (
                  <Link
                    key={d.id}
                    href={`/portal/domains/${d.id}`}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-sm">{d.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {t('domains.autoRenew')}: {d.autoRenew ? t('common.on') : t('common.off')}
                        {d.locked ? ` · ${t('domains.lock')}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm sm:justify-end">
                      <div
                        className={cn(
                          'text-xs',
                          soon ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                        )}
                      >
                        {t('domains.expiry')}: {fmtDate(d.expiryDate, locale)}
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  </Link>
                );
              })}
            </Card>
            <Pagination meta={meta} onPage={(p) => router.push(`/portal/domains?page=${p}`)} />
          </>
        )}
      </QueryState>
    </div>
  );
}

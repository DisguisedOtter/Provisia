'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Globe, Package } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { publicApi } from '@/lib/portal/api';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../../empty-state';
import { PageHeader } from '../../page-header';
import { QueryState } from '../../query-state';
import { CardsSkeleton } from '../../skeletons';
import { OrderSteps } from './steps';

export function OrderGroupsView() {
  const { t } = useI18n();
  const groups = useQuery({
    queryKey: portalKeys.catalogGroups,
    queryFn: async () => (await publicApi.catalog.groups()).data,
    staleTime: 5 * 60_000,
  });
  return (
    <div>
      <OrderSteps current={0} />
      <PageHeader title={t('order.title')} description={t('order.description')}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/domain-search">
            <Globe className="size-4" /> {t('domains.register')}
          </Link>
        </Button>
      </PageHeader>
      <QueryState
        query={groups}
        skeleton={<CardsSkeleton count={3} />}
        isEmpty={(g) => g.filter((x) => !x.hidden).length === 0}
        empty={<EmptyState icon={Package} title={t('order.noGroups')} />}
      >
        {(list) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list
              .filter((g) => !g.hidden)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((g) => (
                <Link key={g.id} href={`/order/${g.slug}`} className="group">
                  <Card className="h-full transition-colors group-hover:border-foreground/40">
                    <CardContent className="flex h-full flex-col p-5">
                      <div className="mb-3 grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Package className="size-5" />
                      </div>
                      <h2 className="font-semibold">{g.name}</h2>
                      {g.description ? (
                        <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
                          {g.description}
                        </p>
                      ) : null}
                      <span className="mt-auto inline-flex items-center gap-1 pt-4 font-medium text-sm">
                        {t('order.products')} <ChevronRight className="size-4" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

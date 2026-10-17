'use client';

import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { publicApi } from '@/lib/portal/api';
import type { DictKey } from '@/lib/portal/dictionary';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../../empty-state';
import { Money } from '../../money';
import { PageHeader } from '../../page-header';
import { QueryState } from '../../query-state';
import { CardsSkeleton } from '../../skeletons';
import { fromPrice } from './price';
import { OrderSteps } from './steps';

export function OrderProductsView({ groupSlug }: { groupSlug: string }) {
  const { t } = useI18n();
  const groups = useQuery({
    queryKey: portalKeys.catalogGroups,
    queryFn: async () => (await publicApi.catalog.groups()).data,
    staleTime: 5 * 60_000,
  });
  const group = groups.data?.find((g) => g.slug === groupSlug);
  const products = useQuery({
    queryKey: portalKeys.catalogProducts(group?.id),
    queryFn: async () => (await publicApi.catalog.products(group?.id)).data,
    enabled: Boolean(group),
    staleTime: 5 * 60_000,
  });
  return (
    <div>
      <OrderSteps current={0} />
      <PageHeader
        back={{ href: '/order', label: t('order.groups') }}
        title={group?.name ?? t('order.products')}
        description={group?.description ?? undefined}
      />
      {groups.isSuccess && !group ? (
        <EmptyState icon={Package} title={t('common.notFound')} />
      ) : (
        <QueryState
          query={products}
          skeleton={<CardsSkeleton count={3} />}
          isEmpty={(p) => p.filter((x) => !x.hidden).length === 0}
          empty={<EmptyState icon={Package} title={t('order.noProducts')} />}
        >
          {(list) => (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list
                .filter((p) => !p.hidden)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((p) => {
                  const from = fromPrice(p.prices);
                  const soldOut = p.stockControl && p.stock <= 0;
                  return (
                    <Card key={p.id} className="flex flex-col">
                      <CardContent className="flex flex-1 flex-col p-5">
                        <h2 className="font-semibold text-lg">{p.name}</h2>
                        {p.description ? (
                          <p className="mt-1 whitespace-pre-line text-muted-foreground text-sm">
                            {p.description}
                          </p>
                        ) : null}
                        <div className="mt-4 flex items-baseline gap-1">
                          {from ? (
                            <>
                              <span className="text-muted-foreground text-xs">
                                {t('order.from')}
                              </span>
                              <Money
                                amount={Math.round(from.perMonth)}
                                currency={from.price.currency}
                                className="font-semibold text-2xl"
                              />
                              <span className="text-muted-foreground text-xs">
                                / {t('cycle.short.monthly' as DictKey)}
                              </span>
                            </>
                          ) : (
                            <span className="font-semibold text-2xl">{t('common.free')}</span>
                          )}
                        </div>
                        {from && from.price.billingCycle !== 'monthly' ? (
                          <p className="text-muted-foreground text-xs">
                            <Money amount={from.price.recurring} currency={from.price.currency} />{' '}
                            {t(`cycle.${from.price.billingCycle}` as DictKey).toLowerCase()}
                          </p>
                        ) : null}
                        <Button className="mt-5 w-full" asChild={!soldOut} disabled={soldOut}>
                          {soldOut ? (
                            <span>{t('order.outOfStock')}</span>
                          ) : (
                            <Link href={`/order/${groupSlug}/${p.slug}`}>
                              {t('order.orderNow')}
                            </Link>
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

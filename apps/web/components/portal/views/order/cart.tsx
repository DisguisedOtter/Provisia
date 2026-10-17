'use client';

import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { publicApi } from '@/lib/portal/api';
import { type CartLine, cart, cartTotals, toCartItems, useCart } from '@/lib/portal/cart';
import type { DictKey } from '@/lib/portal/dictionary';
import { useClientProfile } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../../empty-state';
import { Money } from '../../money';
import { PageHeader } from '../../page-header';
import { OrderSteps } from './steps';

function lineLabel(l: CartLine, t: ReturnType<typeof useI18n>['t']) {
  if (l.type === 'domain_register') return `${t('cart.registerDomain')}: ${l.domainName}`;
  if (l.type === 'domain_transfer') return `${t('cart.transferDomain')}: ${l.domainName}`;
  return `${l.productName ?? t('services.product')}${l.domainName ? ` · ${l.domainName}` : ''}`;
}

/** Shared cart lines + totals block (used by cart and checkout). */
export function CartSummary({
  editable,
  country,
  vatNumber,
  promoCode,
}: {
  editable?: boolean;
  country: string;
  vatNumber: string;
  promoCode: string;
}) {
  const { t } = useI18n();
  const { lines } = useCart();
  const items = toCartItems(lines);
  const estimate = useQuery({
    queryKey: ['public', 'quote', items, country, vatNumber, promoCode],
    queryFn: async () =>
      (
        await publicApi.orders.quote({
          items,
          country,
          vatNumber: vatNumber || undefined,
          promoCode: promoCode || undefined,
        })
      ).data,
    enabled: lines.length > 0 && country.length === 2,
    retry: false,
    staleTime: 30_000,
  });
  const local = cartTotals(lines);
  const currency = estimate.data?.currency ?? local.currency;
  return (
    <div className="space-y-3 text-sm">
      <ul className="divide-y">
        {lines.map((l) => (
          <li key={l.key} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{lineLabel(l, t)}</div>
              <div className="text-muted-foreground text-xs">
                {t(`cycle.${l.billingCycle}` as DictKey)}
                {l.setupFee > 0
                  ? ` · ${t('order.setupFee', { fee: '' }).replace('+', '').trim()} `
                  : ''}
                {l.setupFee > 0 ? <Money amount={l.setupFee} currency={l.currency} /> : null}
              </div>
            </div>
            <Money
              amount={(l.recurring + l.setupFee) * l.quantity}
              currency={l.currency}
              className="font-medium"
            />
            {editable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.remove')}
                onClick={() => cart.remove(l.key)}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="space-y-1 border-t pt-3">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('common.subtotal')}</dt>
          <dd>
            <Money amount={estimate.data?.subtotal ?? local.dueToday} currency={currency} />
          </dd>
        </div>
        {estimate.data && 'discount' in estimate.data && Number(estimate.data.discount) > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('common.discount')}</dt>
            <dd>
              <Money amount={-Number(estimate.data.discount)} currency={currency} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">
            {t('common.tax')}
            {estimate.data?.reverseCharge ? ` (${t('cart.reverseCharge')})` : ''}
          </dt>
          <dd>
            {estimate.isFetching && !estimate.data ? (
              <Skeleton className="h-4 w-14" />
            ) : estimate.data ? (
              <Money amount={estimate.data.taxTotal} currency={currency} />
            ) : (
              <span className="text-muted-foreground text-xs">{t('cart.estimateUnavailable')}</span>
            )}
          </dd>
        </div>
        <div className="flex justify-between border-t pt-2 font-semibold text-base">
          <dt>{t('cart.dueToday')}</dt>
          <dd>
            <Money amount={estimate.data?.total ?? local.dueToday} currency={currency} />
          </dd>
        </div>
      </dl>
      {promoCode &&
      estimate.data &&
      'promoValid' in estimate.data &&
      estimate.data.promoValid === false ? (
        <p className="text-destructive text-xs">{t('cart.promoInvalid')}</p>
      ) : null}
    </div>
  );
}

export function CartView() {
  const { t } = useI18n();
  const state = useCart();
  const profile = useClientProfile();
  const [promo, setPromo] = useState(state.promoCode);
  const [country, setCountry] = useState(state.country);
  const [vat, setVat] = useState(state.vatNumber);
  useEffect(() => {
    if (profile.data) {
      setCountry(profile.data.country);
      setVat(profile.data.vatNumber ?? '');
      cart.setTaxContext(profile.data.country, profile.data.vatNumber ?? '');
    }
  }, [profile.data]);

  if (state.lines.length === 0) {
    return (
      <div>
        <OrderSteps current={2} />
        <EmptyState
          icon={ShoppingCart}
          title={t('cart.empty')}
          description={t('cart.emptyHint')}
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/order">{t('cart.browse')}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/domain-search">{t('nav.domainSearch')}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }
  return (
    <div>
      <OrderSteps current={2} />
      <PageHeader
        title={t('cart.title')}
        description={t('cart.itemsCount', { count: state.lines.length })}
      >
        <Button variant="ghost" size="sm" asChild>
          <Link href="/order">{t('order.continueShopping')}</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => cart.clear()}>
          {t('cart.clear')}
        </Button>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent>
              <CartSummary editable country={country} vatNumber={vat} promoCode={state.promoCode} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('cart.promo')}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                value={promo}
                onChange={(e) => setPromo(e.target.value.toUpperCase())}
                placeholder="PROMO2026"
                className="uppercase"
              />
              <Button variant="outline" onClick={() => cart.setPromo(promo.trim())}>
                {t('cart.promoApply')}
              </Button>
            </CardContent>
          </Card>
          {!profile.data ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('cart.taxEstimate')}</CardTitle>
                <CardDescription>{t('cart.taxEstimateHint')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cart-country">{t('cart.country')}</Label>
                  <Input
                    id="cart-country"
                    maxLength={2}
                    className="uppercase"
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    onBlur={() => cart.setTaxContext(country, vat)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cart-vat">{t('cart.vatNumber')}</Label>
                  <Input
                    id="cart-vat"
                    className="uppercase"
                    placeholder="NL123456789B01"
                    value={vat}
                    onChange={(e) => setVat(e.target.value.toUpperCase())}
                    onBlur={() => cart.setTaxContext(country, vat)}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Button className="w-full" size="lg" asChild>
            <Link href="/checkout">{t('cart.checkout')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

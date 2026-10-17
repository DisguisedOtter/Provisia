'use client';

import { type BillingCycle, domainNameSchema } from '@provisia/shared';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { publicApi } from '@/lib/portal/api';
import { cart } from '@/lib/portal/cart';
import type { DictKey } from '@/lib/portal/dictionary';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import type { ConfigurableOption } from '@/lib/portal/types';
import { DomainSearch } from '../../domain-search';
import { Money } from '../../money';
import { PageHeader } from '../../page-header';
import { QueryState } from '../../query-state';
import { DetailSkeleton } from '../../skeletons';
import { sortPrices } from './price';
import { OrderSteps } from './steps';

type DomainMode = 'register' | 'transfer' | 'existing';

function OptionField({
  opt,
  cycle,
  value,
  onChange,
  currency,
}: {
  opt: ConfigurableOption;
  cycle: BillingCycle;
  value: unknown;
  onChange: (v: unknown) => void;
  currency: string;
}) {
  const priceOf = (prices?: Partial<Record<BillingCycle, number>>) => prices?.[cycle];
  if (opt.type === 'select') {
    return (
      <div className="space-y-2">
        <Label>{opt.name}</Label>
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(opt.choices ?? []).map((c) => {
              const p = priceOf(c.prices);
              return (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                  {p ? (
                    <>
                      {' '}
                      (+
                      <Money amount={p} currency={currency} />)
                    </>
                  ) : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (opt.type === 'checkbox') {
    const p = priceOf(opt.prices);
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={Boolean(value)} onCheckedChange={(v) => onChange(Boolean(v))} />{' '}
        {opt.name}
        {p ? (
          <span className="text-muted-foreground">
            (+
            <Money amount={p} currency={currency} />)
          </span>
        ) : null}
      </label>
    );
  }
  if (opt.type === 'quantity') {
    const p = priceOf(opt.prices);
    return (
      <div className="space-y-2">
        <Label>
          {opt.name}
          {p ? (
            <span className="text-muted-foreground">
              {' '}
              (+
              <Money amount={p} currency={currency} /> × )
            </span>
          ) : null}
        </Label>
        <Input
          type="number"
          min={opt.min ?? 0}
          max={opt.max ?? 100}
          value={Number(value ?? opt.min ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32"
        />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label>{opt.name}</Label>
      <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function OrderConfigureView({
  groupSlug,
  productSlug,
}: {
  groupSlug: string;
  productSlug: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const query = useQuery({
    queryKey: portalKeys.catalogProduct(productSlug),
    queryFn: async () => (await publicApi.catalog.product(productSlug)).data,
    staleTime: 5 * 60_000,
  });
  const [cycle, setCycle] = useState<BillingCycle | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [domainMode, setDomainMode] = useState<DomainMode>('register');
  const [domain, setDomain] = useState('');
  const [eppCode, setEppCode] = useState('');
  const [domainPrice, setDomainPrice] = useState<{ amount: number; currency: string } | null>(null);

  const product = query.data;
  const prices = useMemo(() => sortPrices(product?.prices ?? []), [product]);
  const activeCycle = cycle ?? prices[0]?.billingCycle ?? 'monthly';
  const price = prices.find((p) => p.billingCycle === activeCycle) ?? prices[0];
  const options = product?.configurableOptions ?? [];

  const optionsTotal = options.reduce((sum, o) => {
    const v = config[o.id];
    if (o.type === 'select')
      return sum + (o.choices?.find((c) => c.id === v)?.prices?.[activeCycle] ?? 0);
    if (o.type === 'checkbox') return sum + (v ? (o.prices?.[activeCycle] ?? 0) : 0);
    if (o.type === 'quantity') return sum + Number(v ?? 0) * (o.prices?.[activeCycle] ?? 0);
    return sum;
  }, 0);

  const domainOk =
    !product?.requiresDomain ||
    (domainNameSchema.safeParse(domain).success &&
      (domainMode !== 'transfer' || eppCode.length > 0));

  function addToCart() {
    if (!product || !price) return;
    const missing = options.filter(
      (o) => o.required && (config[o.id] === undefined || config[o.id] === ''),
    );
    if (missing.length) {
      toast.error(`${t('val.required')}: ${missing.map((m) => m.name).join(', ')}`);
      return;
    }
    cart.add({
      type: 'product',
      productId: product.id,
      productName: product.name,
      groupSlug,
      productSlug,
      domainName: product.requiresDomain ? domain.toLowerCase() : undefined,
      billingCycle: price.billingCycle,
      quantity: 1,
      config: { ...config, ...(product.requiresDomain ? { domainMode } : {}) },
      setupFee: price.setupFee,
      recurring: price.recurring + optionsTotal,
      currency: price.currency,
    });
    if (product.requiresDomain && domainMode === 'register' && domain) {
      cart.add({
        type: 'domain_register',
        domainName: domain.toLowerCase(),
        billingCycle: 'annually',
        quantity: 1,
        years: 1,
        config: {},
        setupFee: 0,
        recurring: domainPrice?.amount ?? 0,
        currency: domainPrice?.currency ?? price.currency,
      });
    }
    if (product.requiresDomain && domainMode === 'transfer' && domain) {
      cart.add({
        type: 'domain_transfer',
        domainName: domain.toLowerCase(),
        billingCycle: 'annually',
        quantity: 1,
        years: 1,
        config: { eppCode },
        setupFee: 0,
        recurring: domainPrice?.amount ?? 0,
        currency: domainPrice?.currency ?? price.currency,
      });
    }
    toast.success(t('order.addedToCart'));
    router.push('/cart');
  }

  return (
    <div>
      <OrderSteps current={1} />
      <QueryState query={query} skeleton={<DetailSkeleton />} kind="item">
        {(p) => (
          <>
            <PageHeader
              back={{ href: `/order/${groupSlug}`, label: t('order.products') }}
              title={p.name}
              description={p.description ?? undefined}
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('order.billingCycle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RadioGroup
                      value={activeCycle}
                      onValueChange={(v) => setCycle(v as BillingCycle)}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      {prices.map((pr) => (
                        <label
                          key={pr.id}
                          className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
                        >
                          <RadioGroupItem value={pr.billingCycle} />
                          <span className="flex-1 text-sm">
                            {t(`cycle.${pr.billingCycle}` as DictKey)}
                          </span>
                          <span className="text-right text-sm">
                            <Money
                              amount={pr.recurring}
                              currency={pr.currency}
                              className="font-medium"
                            />
                            {pr.setupFee > 0 ? (
                              <span className="block text-muted-foreground text-xs">
                                {t('order.setupFee', { fee: '' })}
                                <Money amount={pr.setupFee} currency={pr.currency} />
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </CardContent>
                </Card>

                {options.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('order.options')}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      {options.map((o) => (
                        <OptionField
                          key={o.id}
                          opt={o}
                          cycle={activeCycle}
                          value={config[o.id]}
                          onChange={(v) => setConfig((c) => ({ ...c, [o.id]: v }))}
                          currency={price?.currency ?? 'EUR'}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {p.requiresDomain ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('order.domainStep')}</CardTitle>
                      <CardDescription>{t('order.domainHint')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RadioGroup
                        value={domainMode}
                        onValueChange={(v) => {
                          setDomainMode(v as DomainMode);
                          setDomain('');
                          setDomainPrice(null);
                        }}
                        className="grid gap-2 sm:grid-cols-3"
                      >
                        {(['register', 'transfer', 'existing'] as const).map((m) => (
                          <label
                            key={m}
                            className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
                          >
                            <RadioGroupItem value={m} />
                            <span className="text-sm">{t(`order.domain.${m}`)}</span>
                          </label>
                        ))}
                      </RadioGroup>
                      {domainMode === 'register' ? (
                        <DomainSearch
                          mode="select"
                          selected={domain}
                          onSelect={(d, pr) => {
                            setDomain(d);
                            setDomainPrice(pr);
                          }}
                        />
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="existing-domain">{t('domains.transferDomain')}</Label>
                            <Input
                              id="existing-domain"
                              placeholder="example.nl"
                              autoCapitalize="none"
                              value={domain}
                              onChange={(e) => setDomain(e.target.value.trim())}
                            />
                            {domainMode === 'existing' ? (
                              <p className="text-muted-foreground text-xs">
                                {t('order.domain.existingHint')}
                              </p>
                            ) : null}
                          </div>
                          {domainMode === 'transfer' ? (
                            <div className="space-y-2">
                              <Label htmlFor="epp">{t('domains.transferEpp')}</Label>
                              <Input
                                id="epp"
                                autoComplete="off"
                                value={eppCode}
                                onChange={(e) => setEppCode(e.target.value)}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
                      {domain && domainNameSchema.safeParse(domain).success ? (
                        <p className="text-sm">{t('order.domain.selected', { domain })}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}
              </div>

              <div>
                <Card className="lg:sticky lg:top-20">
                  <CardHeader>
                    <CardTitle className="text-base">{t('order.summary')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{p.name}</span>
                      {price ? (
                        <Money amount={price.recurring + optionsTotal} currency={price.currency} />
                      ) : null}
                    </div>
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>{t('order.billingCycle')}</span>
                      <span>{t(`cycle.${activeCycle}` as DictKey)}</span>
                    </div>
                    {price && price.setupFee > 0 ? (
                      <div className="flex justify-between text-muted-foreground text-xs">
                        <span>{t('order.setupFee', { fee: '' }).replace('+', '').trim()}</span>
                        <Money amount={price.setupFee} currency={price.currency} />
                      </div>
                    ) : null}
                    {p.requiresDomain && domain && domainMode !== 'existing' ? (
                      <div className="flex justify-between gap-2">
                        <span>
                          {domainMode === 'register'
                            ? t('cart.registerDomain')
                            : t('cart.transferDomain')}
                          : {domain}
                        </span>
                        {domainPrice ? (
                          <Money amount={domainPrice.amount} currency={domainPrice.currency} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t pt-3 font-semibold">
                      <span>{t('cart.dueToday')}</span>
                      {price ? (
                        <Money
                          amount={
                            price.recurring +
                            optionsTotal +
                            price.setupFee +
                            (domainMode !== 'existing' && domain ? (domainPrice?.amount ?? 0) : 0)
                          }
                          currency={price.currency}
                        />
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t('common.excl')} {t('common.tax')}. {t('cart.estimateUnavailable')}
                    </p>
                    <Button className="w-full" disabled={!price || !domainOk} onClick={addToCart}>
                      <ShoppingCart className="size-4" /> {t('order.addToCart')}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

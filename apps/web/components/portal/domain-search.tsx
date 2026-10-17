'use client';

import { type AvailabilityResult, domainNameSchema, splitDomainName } from '@provisia/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Search, ShoppingCart, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { publicApi } from '@/lib/portal/api';
import { cart, useCart } from '@/lib/portal/cart';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';
import { ErrorState } from './error-boundary';
import { Money } from './money';

type Price = { amount: number; currency: string } | null;

function ResultRow({
  r,
  mode,
  selected,
  onSelect,
  inCart,
}: {
  r: AvailabilityResult;
  mode: 'cart' | 'select';
  selected?: string;
  onSelect?: (domain: string, price: Price) => void;
  inCart: boolean;
}) {
  const { t } = useI18n();
  const price: Price = r.price ? { amount: r.price.amount, currency: r.price.currency } : null;
  const isSelected = selected === r.domain;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full',
          r.status === 'available'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            : r.status === 'taken'
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-muted text-muted-foreground',
        )}
      >
        {r.status === 'available' ? (
          <Check className="size-3.5" />
        ) : r.status === 'taken' ? (
          <X className="size-3.5" />
        ) : (
          '?'
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">
          {r.domain}
          {r.premium ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-300">
              {t('search.premium')}
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground text-xs">
          {r.status === 'available'
            ? t('search.available')
            : r.status === 'taken'
              ? t('search.taken')
              : (r.reason ?? t('search.unknown'))}
        </div>
      </div>
      {price && r.status === 'available' ? (
        <div className="text-right text-sm">
          <Money amount={price.amount} currency={price.currency} className="font-medium" />
          <span className="text-muted-foreground text-xs">
            {' '}
            {r.price?.years === 1
              ? t('search.perYear')
              : `/ ${t('common.yearN', { count: r.price?.years ?? 1 })}`}
          </span>
        </div>
      ) : null}
      {r.status === 'available' ? (
        mode === 'cart' ? (
          <Button
            size="sm"
            variant={inCart ? 'secondary' : 'default'}
            disabled={inCart}
            onClick={() => {
              cart.add({
                type: 'domain_register',
                domainName: r.domain,
                billingCycle: 'annually',
                quantity: 1,
                years: r.price?.years ?? 1,
                config: {},
                setupFee: 0,
                recurring: price?.amount ?? 0,
                currency: price?.currency ?? 'EUR',
              });
              toast.success(t('order.addedToCart'));
            }}
          >
            <ShoppingCart className="size-4" /> {inCart ? t('search.inCart') : t('search.add')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={isSelected ? 'secondary' : 'default'}
            onClick={() => onSelect?.(r.domain, price)}
          >
            {isSelected ? (
              <>
                <Check className="size-4" />{' '}
                {t('order.domain.selected', { domain: '' }).replace(':', '').trim()}
              </>
            ) : (
              t('search.add')
            )}
          </Button>
        )
      ) : r.status === 'taken' && mode === 'cart' ? (
        <Button size="sm" variant="outline" asChild>
          <a href={`/portal/domains/transfer?domain=${encodeURIComponent(r.domain)}`}>
            {t('search.transfer')}
          </a>
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Availability search box + results. `mode="cart"` adds registrations to the cart (standalone page);
 * `mode="select"` reports the chosen domain back to the order configurator.
 */
export function DomainSearch({
  mode = 'cart',
  selected,
  onSelect,
  initial = '',
}: {
  mode?: 'cart' | 'select';
  selected?: string;
  onSelect?: (domain: string, price: Price) => void;
  initial?: string;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState(initial);
  const { lines } = useCart();
  const tlds = useQuery({
    queryKey: portalKeys.tlds,
    queryFn: async () => (await publicApi.domains.tlds()).data,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const search = useMutation({
    mutationFn: async (raw: string) => {
      const q = raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      const known = (tlds.data ?? []).map((x) => x.tld);
      if (q.includes('.')) {
        const parsed = domainNameSchema.safeParse(q);
        if (!parsed.success) throw new ApiError(400, 'validation_error', t('search.invalid'));
        return publicApi.domains.check({ domain: parsed.data, limit: 10 });
      }
      const { sld } = splitDomainName(q, known);
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sld))
        throw new ApiError(400, 'validation_error', t('search.invalid'));
      return publicApi.domains.check({ sld, limit: 10 });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const results = search.data
    ? [
        ...(search.data.data.requested ? [search.data.data.requested] : []),
        ...search.data.data.suggestions.filter(
          (s) => s.domain !== search.data?.data.requested?.domain,
        ),
      ]
    : [];

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) search.mutate(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('search.placeholder')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 text-base"
        />
        <Button type="submit" size="lg" disabled={search.isPending || !input.trim()}>
          <Search className="size-4" />{' '}
          <span className="hidden sm:inline">{t('search.button')}</span>
        </Button>
      </form>
      {search.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : search.isError && !(search.error instanceof ApiError && search.error.status === 400) ? (
        <ErrorState error={search.error} compact onRetry={() => search.mutate(input)} />
      ) : results.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-card">
          {results.map((r) => (
            <ResultRow
              key={r.domain}
              r={r}
              mode={mode}
              selected={selected}
              onSelect={onSelect}
              inCart={lines.some((l) => l.domainName === r.domain && l.type === 'domain_register')}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Price table of enabled TLDs (register / transfer / renew per year). */
export function TldPriceTable() {
  const { t } = useI18n();
  const tlds = useQuery({
    queryKey: portalKeys.tlds,
    queryFn: async () => (await publicApi.domains.tlds()).data,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (tlds.isPending) return <Skeleton className="h-40" />;
  if (tlds.isError) return <ErrorState error={tlds.error} compact />;
  const rows = tlds.data
    .map((x) => ({
      tld: x.tld,
      featured: x.featured,
      p: x.prices.find((p) => p.years === 1) ?? x.prices[0],
      currency: x.currency,
    }))
    .filter((x) => x.p);
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2">{t('search.tld')}</th>
            <th className="px-4 py-2 text-right">{t('search.register')}</th>
            <th className="px-4 py-2 text-right">{t('search.transfer')}</th>
            <th className="px-4 py-2 text-right">{t('search.renew')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows
            .sort((a, b) => Number(b.featured) - Number(a.featured) || a.tld.localeCompare(b.tld))
            .map((r) => (
              <tr key={r.tld}>
                <td className="px-4 py-2 font-medium">.{r.tld}</td>
                <td className="px-4 py-2 text-right">
                  <Money amount={r.p?.register ?? 0} currency={r.p?.currency ?? r.currency} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money amount={r.p?.transfer ?? 0} currency={r.p?.currency ?? r.currency} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money amount={r.p?.renew ?? 0} currency={r.p?.currency ?? r.currency} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

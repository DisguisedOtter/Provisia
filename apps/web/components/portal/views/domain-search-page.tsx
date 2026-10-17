'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/portal/cart';
import { useI18n } from '@/lib/portal/i18n';
import { DomainSearch, TldPriceTable } from '../domain-search';

export function DomainSearchPageView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const { lines } = useCart();
  const domainLines = lines.filter((l) => l.type !== 'product').length;
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="pt-6 text-center">
        <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('search.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('search.description')}</p>
      </div>
      <DomainSearch mode="cart" initial={params.get('q') ?? ''} />
      {domainLines > 0 ? (
        <div className="flex justify-center">
          <Button asChild size="lg">
            <Link href="/cart">
              {t('cart.checkout')} ({t('cart.itemsCount', { count: lines.length })})
            </Link>
          </Button>
        </div>
      ) : null}
      <section className="space-y-3">
        <h2 className="font-medium">{t('search.tldPrices')}</h2>
        <TldPriceTable />
      </section>
    </div>
  );
}

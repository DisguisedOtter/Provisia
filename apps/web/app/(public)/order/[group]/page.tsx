import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { OrderProductsView } from '@/components/portal/views/order/products';
import { portalKeys } from '@/lib/portal/hooks';
import { getPublicCatalog, getPublicSettings, pageMetadata, SITE_FALLBACK } from '@/lib/seo';

type Params = Promise<{ group: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { group: slug } = await params;
  const [catalog, settings] = await Promise.all([getPublicCatalog(), getPublicSettings()]);
  const name = settings?.companyName || SITE_FALLBACK.name;
  const group = catalog?.find((g) => g.slug === slug && !g.hidden);
  if (!group)
    return pageMetadata({
      title: 'Products',
      path: `/order/${slug}`,
      siteName: name,
      noindex: true,
    });
  const cheapest = group.products
    .flatMap((p) => p.prices.map((x) => x.recurring))
    .filter((x) => x > 0)
    .sort((a, b) => a - b)[0];
  return pageMetadata({
    title: group.name,
    description:
      group.description ??
      `${group.name} from ${name}${cheapest !== undefined ? ` from ${(cheapest / 100).toFixed(2)} per month` : ''}. ${group.products.length} plans, instant setup.`,
    path: `/order/${group.slug}`,
    siteName: name,
    image: settings?.logoUrl || null,
  });
}

export default async function Page({ params }: { params: Params }) {
  const { group: slug } = await params;
  const catalog = await getPublicCatalog();
  const qc = new QueryClient();
  if (catalog) {
    qc.setQueryData(
      portalKeys.catalogGroups,
      catalog.map(({ products: _p, ...g }) => g),
    );
    const group = catalog.find((g) => g.slug === slug);
    if (group) qc.setQueryData(portalKeys.catalogProducts(group.id), group.products);
  }
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <OrderProductsView groupSlug={slug} />
    </HydrationBoundary>
  );
}

import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { OrderConfigureView } from '@/components/portal/views/order/configure';
import { JsonLd } from '@/components/seo/json-ld';
import { portalKeys } from '@/lib/portal/hooks';
import {
  getPublicProduct,
  getPublicSettings,
  lowestPrice,
  pageMetadata,
  SITE_FALLBACK,
  siteUrl,
} from '@/lib/seo';

type Params = Promise<{ group: string; product: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { group, product: slug } = await params;
  const [product, settings] = await Promise.all([getPublicProduct(slug), getPublicSettings()]);
  const name = settings?.companyName || SITE_FALLBACK.name;
  const path = `/order/${group}/${slug}`;
  if (!product) return pageMetadata({ title: 'Configure', path, siteName: name, noindex: true });
  const price = lowestPrice(product);
  return pageMetadata({
    title: product.name,
    description:
      product.description ??
      `${product.name} from ${name}${price ? ` from ${(price.amount / 100).toFixed(2)} ${price.currency} per month` : ''}. Order online with instant setup.`,
    path,
    siteName: name,
    image: settings?.logoUrl || null,
  });
}

export default async function Page({ params }: { params: Params }) {
  const { group, product: slug } = await params;
  const product = await getPublicProduct(slug);
  const qc = new QueryClient();
  if (product) qc.setQueryData(portalKeys.catalogProduct(slug), product);
  const price = product ? lowestPrice(product) : null;
  const structured = product
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        ...(product.description ? { description: product.description } : {}),
        sku: product.slug,
        url: new URL(`order/${group}/${slug}`, siteUrl()).toString(),
        ...(price
          ? {
              offers: {
                '@type': 'Offer',
                price: (price.amount / 100).toFixed(2),
                priceCurrency: price.currency,
                availability: 'https://schema.org/InStock',
                url: new URL(`order/${group}/${slug}`, siteUrl()).toString(),
              },
            }
          : {}),
      }
    : null;
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      {structured ? <JsonLd data={structured} /> : null}
      <OrderConfigureView groupSlug={group} productSlug={slug} />
    </HydrationBoundary>
  );
}

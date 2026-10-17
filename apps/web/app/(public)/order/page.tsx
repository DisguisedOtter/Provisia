import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { OrderGroupsView } from '@/components/portal/views/order/groups';
import { JsonLd } from '@/components/seo/json-ld';
import { portalKeys } from '@/lib/portal/hooks';
import {
  getPublicCatalog,
  getPublicSettings,
  pageMetadata,
  SITE_FALLBACK,
  siteUrl,
} from '@/lib/seo';

// Rendered per request (fetches are cached for 5 minutes) so the catalog never freezes at build time.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const name = settings?.companyName || SITE_FALLBACK.name;
  return pageMetadata({
    title: 'Web hosting, VPS and domains',
    description: `Order web hosting, VPS servers and domain names from ${name}. Instant setup, online payment and a client portal to manage everything.`,
    path: '/order',
    siteName: name,
    image: settings?.logoUrl || null,
  });
}

export default async function Page() {
  const [catalog, settings] = await Promise.all([getPublicCatalog(), getPublicSettings()]);
  const qc = new QueryClient();
  if (catalog)
    qc.setQueryData(
      portalKeys.catalogGroups,
      catalog.map(({ products: _p, ...g }) => g),
    );
  const name = settings?.companyName || SITE_FALLBACK.name;
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: siteUrl().toString(),
    ...(settings?.logoUrl ? { logo: settings.logoUrl } : {}),
    ...(settings?.supportEmail ? { email: settings.supportEmail } : {}),
  };
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <JsonLd data={organization} />
      <OrderGroupsView />
    </HydrationBoundary>
  );
}

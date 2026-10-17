import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DomainSearchPageView } from '@/components/portal/views/domain-search-page';
import { getPublicSettings, pageMetadata, SITE_FALLBACK } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const name = settings?.companyName || SITE_FALLBACK.name;
  return pageMetadata({
    title: 'Domain name search',
    description: `Check if your domain name is available and register it with ${name}. Hundreds of extensions, transparent pricing, free DNS management.`,
    path: '/domain-search',
    siteName: name,
    image: settings?.logoUrl || null,
  });
}

export default function Page() {
  return (
    <Suspense>
      <DomainSearchPageView />
    </Suspense>
  );
}

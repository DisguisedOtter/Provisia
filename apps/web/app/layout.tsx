import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { getPublicSettings, SITE_FALLBACK, siteUrl } from '@/lib/seo';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const name = settings?.companyName || SITE_FALLBACK.name;
  return {
    metadataBase: siteUrl(),
    title: { default: name, template: `%s · ${name}` },
    description: SITE_FALLBACK.description,
    applicationName: name,
    openGraph: { siteName: name, type: 'website' },
    // Pages opt in to indexing explicitly (storefront); everything else stays out of search engines.
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPublicSettings();
  const lang = settings?.defaultLocale?.slice(0, 2) || 'en';
  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

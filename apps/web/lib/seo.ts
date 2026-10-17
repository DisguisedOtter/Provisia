import 'server-only';
import type { ProductGroup, ProductWithPrices, PublicSettings } from '@provisia/shared';
import type { Metadata } from 'next';

/** Public site URL (canonical / sitemap / Open Graph). */
export function siteUrl(): URL {
  const raw = process.env.WEB_URL ?? process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
  return new URL(raw.endsWith('/') ? raw : `${raw}/`);
}

/** API base for server-side rendering: an internal URL when configured, else the public one. */
function apiBase(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

async function fetchData<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export type PublicCatalog = Array<ProductGroup & { products: ProductWithPrices[] }>;

export const getPublicSettings = () => fetchData<PublicSettings>('/public/settings');
export const getPublicCatalog = () => fetchData<PublicCatalog>('/public/products');
export const getPublicProduct = (slug: string) =>
  fetchData<ProductWithPrices>(`/public/products/${encodeURIComponent(slug)}`);

export const SITE_FALLBACK = {
  name: 'Provisia',
  description:
    'Web hosting, VPS and domain names. Order online and manage everything in one place.',
};

/** Shared metadata builder: title, description, canonical and Open Graph in one place. */
export function pageMetadata(input: {
  title: string;
  description?: string;
  path: string;
  siteName?: string;
  image?: string | null;
  noindex?: boolean;
}): Metadata {
  const siteName = input.siteName ?? SITE_FALLBACK.name;
  const description = input.description ?? SITE_FALLBACK.description;
  return {
    title: input.title,
    description,
    alternates: { canonical: input.path },
    robots: input.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName,
      title: input.title,
      description,
      url: input.path,
      ...(input.image ? { images: [{ url: input.image }] } : {}),
    },
    twitter: { card: 'summary', title: input.title, description },
  };
}

/** Lowest recurring price of a product, for structured data. */
export function lowestPrice(
  product: ProductWithPrices,
): { amount: number; currency: string } | null {
  const prices = product.prices.filter((p) => p.recurring > 0);
  if (prices.length === 0) return null;
  const min = prices.reduce((a, b) => (b.recurring < a.recurring ? b : a));
  return { amount: min.recurring, currency: min.currency };
}

/** Removes `<` so JSON-LD can never close the script tag. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

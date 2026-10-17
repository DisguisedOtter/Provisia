import type { MetadataRoute } from 'next';
import { getPublicCatalog, siteUrl } from '@/lib/seo';

// Built per request from the cached catalog fetch, never from a build-time snapshot.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const url = (path: string) => new URL(path.replace(/^\//, ''), base).toString();
  const entries: MetadataRoute.Sitemap = [
    { url: url('/order'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/domain-search'), changeFrequency: 'monthly', priority: 0.8 },
  ];
  const catalog = (await getPublicCatalog()) ?? [];
  for (const group of catalog) {
    if (group.hidden) continue;
    entries.push({
      url: url(`/order/${group.slug}`),
      lastModified: group.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.9,
    });
    for (const product of group.products) {
      if (product.hidden) continue;
      entries.push({
        url: url(`/order/${group.slug}/${product.slug}`),
        lastModified: product.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }
  return entries;
}

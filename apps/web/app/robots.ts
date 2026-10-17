import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/order', '/domain-search'],
        disallow: [
          '/admin',
          '/portal',
          '/cart',
          '/checkout',
          '/login',
          '/register',
          '/2fa',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          '/api/',
        ],
      },
    ],
    sitemap: new URL('sitemap.xml', siteUrl()).toString(),
  };
}

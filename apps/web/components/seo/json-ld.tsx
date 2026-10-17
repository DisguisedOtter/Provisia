import { jsonLd } from '@/lib/seo';

/** Renders a schema.org JSON-LD block; `data` is serialised with `<` escaped. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify output with `<` escaped (see jsonLd)
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}

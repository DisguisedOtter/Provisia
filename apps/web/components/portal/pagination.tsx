'use client';

import type { PaginationMeta } from '@provisia/shared';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/portal/i18n';

export function Pagination({
  meta,
  onPage,
}: {
  meta: PaginationMeta;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(meta.total / meta.perPage));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{t('common.page', { page: meta.page, pages })}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= pages}
          onClick={() => onPage(meta.page + 1)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}

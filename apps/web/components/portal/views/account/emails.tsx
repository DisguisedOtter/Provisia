'use client';

import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { portalApi } from '@/lib/portal/api';
import { fmtDateTime } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../../empty-state';
import { Pagination } from '../../pagination';
import { QueryState } from '../../query-state';
import { ListSkeleton } from '../../skeletons';
import { StatusBadge } from '../../status-badge';

export function EmailsView() {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: portalKeys.emails(page),
    queryFn: () => portalApi.account.emails({ page, perPage: 25 }),
  });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">{t('account.emails')}</h2>
        <p className="text-muted-foreground text-sm">{t('account.emailsHint')}</p>
      </div>
      <QueryState
        query={query}
        skeleton={<ListSkeleton />}
        empty={<EmptyState icon={Mail} title={t('account.emailsEmpty')} />}
      >
        {({ data, meta }) => (
          <>
            <Card className="divide-y p-0">
              {data.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{e.subject}</div>
                    <div className="truncate text-muted-foreground text-xs">
                      {t('account.to')}: {e.toEmail} ·{' '}
                      {fmtDateTime(e.sentAt ?? e.createdAt, locale)}
                    </div>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
              ))}
            </Card>
            <Pagination meta={meta} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

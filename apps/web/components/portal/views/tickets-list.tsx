'use client';

import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { portalApi } from '@/lib/portal/api';
import { fmtDateTime } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../empty-state';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { QueryState } from '../query-state';
import { ListSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

export function TicketsListView() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const page = Number(params.get('page') ?? 1);
  const tab = params.get('status') ?? 'open';
  const q = tab === 'closed' ? { page, perPage: 25, status: 'closed' } : { page, perPage: 25 };
  const query = useQuery({
    queryKey: portalKeys.tickets(q),
    queryFn: () => portalApi.tickets.list(q),
  });
  const go = (next: { page?: number; status?: string }) => {
    const sp = new URLSearchParams();
    const s = next.status ?? tab;
    if (s !== 'open') sp.set('status', s);
    if ((next.page ?? 1) > 1) sp.set('page', String(next.page));
    router.push(`/portal/tickets${sp.size ? `?${sp}` : ''}`);
  };
  return (
    <div>
      <PageHeader title={t('tickets.title')} description={t('tickets.description')}>
        <Tabs value={tab} onValueChange={(v) => go({ status: v, page: 1 })}>
          <TabsList>
            <TabsTrigger value="open">{t('tickets.filter.open')}</TabsTrigger>
            <TabsTrigger value="closed">{t('tickets.filter.closed')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" asChild>
          <Link href="/portal/tickets/new">
            <Plus className="size-4" /> {t('tickets.new')}
          </Link>
        </Button>
      </PageHeader>
      <QueryState
        query={query}
        skeleton={<ListSkeleton />}
        empty={
          <EmptyState
            icon={LifeBuoy}
            title={t('tickets.empty')}
            description={t('tickets.emptyHint')}
            action={
              <Button asChild>
                <Link href="/portal/tickets/new">{t('tickets.new')}</Link>
              </Button>
            }
          />
        }
      >
        {({ data, meta }) => (
          <>
            <Card className="divide-y p-0">
              {data.map((tk) => (
                <Link
                  key={tk.id}
                  href={`/portal/tickets/${tk.id}`}
                  className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">
                      #{tk.number} · {tk.subject}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {tk.departmentName} · {t('tickets.lastReply')}:{' '}
                      {fmtDateTime(tk.lastReplyAt ?? tk.createdAt, locale)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs capitalize">
                      {t(`tickets.priority.${tk.priority}`)}
                    </span>
                    <StatusBadge status={tk.status} />
                  </div>
                </Link>
              ))}
            </Card>
            <Pagination meta={meta} onPage={(p) => go({ page: p })} />
          </>
        )}
      </QueryState>
    </div>
  );
}

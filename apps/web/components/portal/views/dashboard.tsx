'use client';

import { useQuery } from '@tanstack/react-query';
import { Globe, LifeBuoy, Megaphone, Receipt, Server, ShoppingBag, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/auth';
import { portalApi } from '@/lib/portal/api';
import { daysUntil, fmtDate } from '@/lib/portal/format';
import { portalKeys, useClientProfile } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../empty-state';
import { ErrorState } from '../error-boundary';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { StatusBadge } from '../status-badge';

function Stat({
  icon: Icon,
  label,
  value,
  href,
  loading,
}: {
  icon: typeof Server;
  label: string;
  value: React.ReactNode;
  href: string;
  loading?: boolean;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-muted-foreground text-xs">{label}</div>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-16" />
            ) : (
              <div className="font-semibold text-xl tabular-nums">{value}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardView() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();
  const profile = useClientProfile();

  const services = useQuery({
    queryKey: portalKeys.services({ status: 'active', perPage: 5 }),
    queryFn: () => portalApi.services.list({ status: 'active', perPage: 5 }),
  });
  const domains = useQuery({
    queryKey: portalKeys.domains({ perPage: 100 }),
    queryFn: () => portalApi.domains.list({ perPage: 100 }),
  });
  const invoices = useQuery({
    queryKey: portalKeys.invoices({ status: 'unpaid', perPage: 5 }),
    queryFn: () => portalApi.invoices.list({ status: 'unpaid', perPage: 5 }),
  });
  const tickets = useQuery({
    queryKey: portalKeys.tickets({ status: 'open', perPage: 5 }),
    queryFn: () => portalApi.tickets.list({ status: 'open', perPage: 5 }),
  });
  const announcements = useQuery({
    queryKey: portalKeys.announcements,
    queryFn: async () => (await portalApi.account.announcements()).data,
    retry: false,
  });

  const expiring = (domains.data?.data ?? [])
    .filter((d) => {
      const days = daysUntil(d.expiryDate);
      return days !== null && days <= 60 && d.status === 'active';
    })
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));

  const count = (q: { data?: { meta: { total: number } } }) => q.data?.meta.total ?? '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dash.title')}
        description={me ? t('dash.welcome', { name: me.firstName || me.email }) : undefined}
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/portal/tickets/new">
            <LifeBuoy className="size-4" /> {t('dash.openTicket')}
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/order">
            <ShoppingBag className="size-4" /> {t('dash.orderNew')}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          icon={Server}
          label={t('dash.activeServices')}
          value={count(services)}
          href="/portal/services"
          loading={services.isPending}
        />
        <Stat
          icon={Globe}
          label={t('dash.domainsExpiring')}
          value={domains.isError ? '—' : expiring.length}
          href="/portal/domains"
          loading={domains.isPending}
        />
        <Stat
          icon={Receipt}
          label={t('dash.unpaidInvoices')}
          value={count(invoices)}
          href="/portal/invoices?status=unpaid"
          loading={invoices.isPending}
        />
        <Stat
          icon={LifeBuoy}
          label={t('dash.openTickets')}
          value={count(tickets)}
          href="/portal/tickets"
          loading={tickets.isPending}
        />
        <Stat
          icon={Wallet}
          label={t('dash.credit')}
          value={
            profile.data ? (
              <Money amount={profile.data.creditBalance} currency={profile.data.currency} />
            ) : (
              '—'
            )
          }
          href="/portal/invoices"
          loading={profile.isPending && profile.fetchStatus !== 'idle'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('dash.unpaidInvoices')}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/invoices">{t('common.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {invoices.isPending ? (
              <Skeleton className="h-24" />
            ) : invoices.isError ? (
              <ErrorState error={invoices.error} compact />
            ) : invoices.data.data.length === 0 ? (
              <EmptyState compact title={t('dash.noUnpaid')} />
            ) : (
              <ul className="divide-y">
                {invoices.data.data.map((inv) => {
                  const overdue = (daysUntil(inv.dueDate) ?? 0) < 0;
                  return (
                    <li key={inv.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/portal/invoices/${inv.id}`}
                          className="font-medium text-sm hover:underline"
                        >
                          {inv.number ?? t('status.draft')}
                        </Link>
                        <div className="text-muted-foreground text-xs">
                          {t('dash.due', { date: fmtDate(inv.dueDate, locale) })}
                          {overdue ? <StatusBadge status="overdue" className="ml-2" /> : null}
                        </div>
                      </div>
                      <Money
                        amount={inv.total}
                        currency={inv.currency}
                        className="font-medium text-sm"
                      />
                      <Button size="sm" asChild>
                        <Link href={`/portal/invoices/${inv.id}?pay=1`}>{t('dash.pay')}</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('dash.activeServices')}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/services">{t('common.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {services.isPending ? (
              <Skeleton className="h-24" />
            ) : services.isError ? (
              <ErrorState error={services.error} compact />
            ) : services.data.data.length === 0 ? (
              <EmptyState
                compact
                title={t('dash.noServices')}
                action={
                  <Button size="sm" asChild>
                    <Link href="/order">{t('dash.orderNew')}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {services.data.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/portal/services/${s.id}`}
                        className="block truncate font-medium text-sm hover:underline"
                      >
                        {s.product?.name ?? t('services.product')}
                        {s.domain ? (
                          <span className="font-normal text-muted-foreground"> · {s.domain}</span>
                        ) : null}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {t('services.nextDue')}: {fmtDate(s.nextDueDate, locale)}
                      </div>
                    </div>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('dash.domainsExpiring')}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/domains">{t('common.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {domains.isPending ? (
              <Skeleton className="h-24" />
            ) : domains.isError ? (
              <ErrorState error={domains.error} compact />
            ) : expiring.length === 0 ? (
              <EmptyState compact title={t('dash.noExpiring')} />
            ) : (
              <ul className="divide-y">
                {expiring.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/portal/domains/${d.id}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {d.name}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {t('dash.expires', { date: fmtDate(d.expiryDate, locale) })}
                      </div>
                    </div>
                    {d.autoRenew ? (
                      <span className="text-muted-foreground text-xs">
                        {t('domains.autoRenew')}
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/portal/domains/${d.id}?renew=1`}>{t('domains.renew')}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('dash.openTickets')}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/tickets">{t('common.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {tickets.isPending ? (
              <Skeleton className="h-24" />
            ) : tickets.isError ? (
              <ErrorState error={tickets.error} compact />
            ) : tickets.data.data.length === 0 ? (
              <EmptyState compact title={t('dash.noTickets')} />
            ) : (
              <ul className="divide-y">
                {tickets.data.data.map((tk) => (
                  <li key={tk.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/portal/tickets/${tk.id}`}
                        className="block truncate font-medium text-sm hover:underline"
                      >
                        #{tk.number} · {tk.subject}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {t('tickets.lastReply')}: {fmtDate(tk.lastReplyAt, locale)}
                      </div>
                    </div>
                    <StatusBadge status={tk.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Megaphone className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{t('dash.announcements')}</CardTitle>
        </CardHeader>
        <CardContent>
          {announcements.data && announcements.data.length > 0 ? (
            <ul className="space-y-4">
              {announcements.data.map((a) => (
                <li key={a.id}>
                  <div className="font-medium text-sm">{a.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {fmtDate(a.publishedAt, locale)}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{a.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t('dash.noAnnouncements')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

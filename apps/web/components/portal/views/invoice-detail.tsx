'use client';

import { useQuery } from '@tanstack/react-query';
import { CreditCard, Download } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { portalApi } from '@/lib/portal/api';
import { daysUntil, fmtDate, fmtDateTime } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { KeyValue } from '../key-value';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { PayDialog } from '../pay/pay-dialog';
import { QueryState } from '../query-state';
import { DetailSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

export function InvoiceDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const [payOpen, setPayOpen] = useState(params.get('pay') === '1');
  const query = useQuery({
    queryKey: portalKeys.invoice(id),
    queryFn: async () => (await portalApi.invoices.get(id)).data,
  });
  const txns = useQuery({
    queryKey: portalKeys.invoiceTxns(id),
    queryFn: async () => (await portalApi.invoices.transactions(id)).data,
    retry: false,
  });
  const autoPay = useQuery({
    queryKey: portalKeys.autoPay,
    queryFn: async () => (await portalApi.payments.autoPay()).data,
    retry: false,
  });

  return (
    <QueryState query={query} skeleton={<DetailSkeleton />} kind="item">
      {(inv) => {
        const payable = inv.status === 'unpaid' || inv.status === 'collections';
        const overdueDays = payable ? -(daysUntil(inv.dueDate) ?? 0) : 0;
        return (
          <div className="space-y-6">
            <PageHeader
              back={{ href: '/portal/invoices', label: t('invoices.title') }}
              title={`${t('invoices.number')} ${inv.number ?? ''}`}
              badge={<StatusBadge status={overdueDays > 0 ? 'overdue' : inv.status} />}
              description={
                inv.paidAt
                  ? t('invoices.paidAt', { date: fmtDate(inv.paidAt, locale) })
                  : overdueDays > 0
                    ? t('invoices.overdueBy', { days: overdueDays })
                    : undefined
              }
            >
              <Button variant="outline" size="sm" asChild>
                <a href={portalApi.invoices.pdfUrl(inv.id)} target="_blank" rel="noopener">
                  <Download className="size-4" /> {t('invoices.downloadPdf')}
                </a>
              </Button>
              {payable ? (
                <Button size="sm" onClick={() => setPayOpen(true)}>
                  <CreditCard className="size-4" /> {t('invoices.payAmount', { amount: '' }).trim()}{' '}
                  <Money amount={inv.total - inv.creditApplied} currency={inv.currency} />
                </Button>
              ) : null}
            </PageHeader>

            {payable && autoPay.data?.enabled ? (
              <Alert>
                <AlertDescription>{t('invoices.autoPayNote')}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">{t('invoices.items')}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.description')}</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">
                          {t('common.quantity')}
                        </TableHead>
                        <TableHead className="hidden text-right sm:table-cell">
                          {t('invoices.unit')}
                        </TableHead>
                        <TableHead className="text-right">{t('invoices.amount')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inv.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell>
                            <div className="whitespace-normal">{it.description}</div>
                            {it.periodStart ? (
                              <div className="text-muted-foreground text-xs">
                                {t('invoices.period')}: {fmtDate(it.periodStart, locale)} –{' '}
                                {fmtDate(it.periodEnd, locale)}
                              </div>
                            ) : null}
                            <div className="text-muted-foreground text-xs sm:hidden">
                              {it.quantity} ×{' '}
                              <Money amount={it.unitAmount} currency={inv.currency} />
                            </div>
                          </TableCell>
                          <TableCell className="hidden text-right sm:table-cell">
                            {it.quantity}
                          </TableCell>
                          <TableCell className="hidden text-right sm:table-cell">
                            <Money amount={it.unitAmount} currency={inv.currency} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money amount={it.amount} currency={inv.currency} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 px-4 text-sm sm:px-0">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('common.subtotal')}</dt>
                      <dd>
                        <Money amount={inv.subtotal} currency={inv.currency} />
                      </dd>
                    </div>
                    {inv.taxSummary && inv.taxSummary.length > 0 ? (
                      inv.taxSummary.map((l) => (
                        <div key={l.rate} className="flex justify-between">
                          <dt className="text-muted-foreground">
                            {t('invoices.taxAt', { rate: l.rate })}
                          </dt>
                          <dd>
                            <Money amount={l.tax} currency={inv.currency} />
                          </dd>
                        </div>
                      ))
                    ) : (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          {t('invoices.taxAt', { rate: inv.taxRate })}
                        </dt>
                        <dd>
                          <Money amount={inv.taxTotal} currency={inv.currency} />
                        </dd>
                      </div>
                    )}
                    {inv.creditApplied > 0 ? (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">{t('invoices.creditApplied')}</dt>
                        <dd>
                          <Money amount={-inv.creditApplied} currency={inv.currency} />
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t pt-1 font-semibold">
                      <dt>{t('common.total')}</dt>
                      <dd>
                        <Money amount={inv.total - inv.creditApplied} currency={inv.currency} />
                      </dd>
                    </div>
                  </dl>
                  {inv.reverseCharge ? (
                    <p className="mt-3 px-4 text-muted-foreground text-xs sm:px-0">
                      {t('invoices.reverseCharge')}
                    </p>
                  ) : null}
                  {inv.notes ? (
                    <p className="mt-3 whitespace-pre-line px-4 text-sm sm:px-0">
                      <span className="font-medium">{t('invoices.notes')}:</span> {inv.notes}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('common.details')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeyValue
                      className="sm:grid-cols-1"
                      items={[
                        { label: t('invoices.issued'), value: fmtDate(inv.issueDate, locale) },
                        { label: t('invoices.due'), value: fmtDate(inv.dueDate, locale) },
                        { label: t('common.status'), value: <StatusBadge status={inv.status} /> },
                        {
                          label: t('invoices.paidAt', { date: '' }).replace(/\s+$/, ''),
                          value: fmtDateTime(inv.paidAt, locale),
                          hidden: !inv.paidAt,
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('invoices.transactions')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {txns.data && txns.data.length > 0 ? (
                      <ul className="divide-y text-sm">
                        {txns.data.map((tx) => (
                          <li key={tx.id} className="flex items-center justify-between py-2">
                            <div>
                              <div className="font-medium capitalize">
                                {tx.gateway} · {tx.type}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {fmtDateTime(tx.createdAt, locale)}
                              </div>
                            </div>
                            <Money
                              amount={tx.type === 'refund' ? -tx.amount : tx.amount}
                              currency={tx.currency}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t('invoices.noTransactions')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
            {payable ? <PayDialog invoice={inv} open={payOpen} onOpenChange={setPayOpen} /> : null}
          </div>
        );
      }}
    </QueryState>
  );
}

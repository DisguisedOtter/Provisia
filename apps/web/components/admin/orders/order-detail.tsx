'use client';

import type { OrderItem } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { BILLING_CYCLE_LABELS, fmtDateTime, titleCase } from '@/lib/admin/format';
import { ORDER_STATUS } from '@/lib/admin/status';
import { ClientCell, ProductCell } from '../client-cell';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { DescriptionList } from '../description-list';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatusBadge } from '../status-badge';

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['orders', id], queryFn: () => adminApi.orders.get(id) });
  const o = q.data?.data;

  const after = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['services'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };
  const accept = useMutationFactory(
    () => adminApi.orders.accept(id),
    'Order accepted; provisioning queued',
    after,
  );
  const cancel = useMutationFactory(() => adminApi.orders.cancel(id), 'Order cancelled', after);
  const fraud = useMutationFactory(() => adminApi.orders.fraud(id), 'Order marked as fraud', after);

  const columns: Column<OrderItem>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (it) =>
        it.type === 'product' ? (
          <>
            <ProductCell id={it.productId} />
            {it.domainName ? (
              <span className="text-muted-foreground"> · {it.domainName}</span>
            ) : null}
          </>
        ) : (
          <>
            {titleCase(it.type)} <span className="font-medium">{it.domainName}</span>
          </>
        ),
    },
    { id: 'cycle', header: 'Cycle', cell: (it) => BILLING_CYCLE_LABELS[it.billingCycle] },
    { id: 'qty', header: 'Qty', align: 'center', cell: (it) => it.quantity },
    {
      id: 'setup',
      header: 'Setup',
      align: 'right',
      hideBelow: 'sm',
      cell: (it) => <Money amount={it.setupFee} currency={o?.currency} />,
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (it) => <Money amount={it.amount} currency={o?.currency} />,
    },
    {
      id: 'result',
      header: 'Result',
      hideBelow: 'md',
      cell: (it) =>
        it.serviceId ? (
          <Link href={`/admin/services/${it.serviceId}`} className="hover:underline">
            Service
          </Link>
        ) : it.domainId ? (
          <Link href={`/admin/domains/${it.domainId}`} className="hover:underline">
            Domain
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        crumbs={[{ label: 'Orders', href: '/admin/orders' }, { label: o ? `#${o.number}` : '…' }]}
        title={o ? `Order #${o.number}` : 'Order'}
        badges={o ? <StatusBadge value={o.status} map={ORDER_STATUS} /> : null}
        actions={
          o && o.status === 'pending' ? (
            <>
              <ConfirmButton
                variant="outline"
                title="Mark as fraud?"
                description="The order is cancelled and the client flagged."
                destructive
                confirmLabel="Mark fraud"
                onConfirm={() => fraud.mutateAsync()}
              >
                <ShieldAlert /> Fraud
              </ConfirmButton>
              <ConfirmButton
                variant="outline"
                title="Cancel this order?"
                description="Any draft invoice is cancelled too."
                destructive
                confirmLabel="Cancel order"
                onConfirm={() => cancel.mutateAsync()}
              >
                <Ban /> Cancel
              </ConfirmButton>
              <ConfirmButton
                title="Accept this order?"
                description="Services are created and provisioning jobs are queued."
                confirmLabel="Accept"
                onConfirm={() => accept.mutateAsync()}
                loading={accept.isPending}
              >
                <Check /> Accept
              </ConfirmButton>
            </>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {o ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleTable
                    columns={columns}
                    rows={o.items}
                    rowKey={(i) => i.id}
                    emptyTitle="No items"
                  />
                  <dl className="mt-4 ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="text-right">
                      <Money amount={o.subtotal} currency={o.currency} />
                    </dd>
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="text-right">
                      <Money amount={o.taxTotal} currency={o.currency} />
                    </dd>
                    <dt className="font-medium">Total</dt>
                    <dd className="text-right font-medium">
                      <Money amount={o.total} currency={o.currency} />
                    </dd>
                  </dl>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList
                  columns={1}
                  items={[
                    { label: 'Client', value: <ClientCell id={o.clientId} /> },
                    { label: 'Placed', value: fmtDateTime(o.createdAt) },
                    {
                      label: 'Invoice',
                      value: o.invoiceId ? (
                        <Link className="hover:underline" href={`/admin/invoices/${o.invoiceId}`}>
                          View invoice
                        </Link>
                      ) : (
                        'Not invoiced'
                      ),
                    },
                    { label: 'Promo code', value: o.promoCode },
                    {
                      label: 'IP address',
                      value: o.ip ? <span className="font-mono text-xs">{o.ip}</span> : null,
                    },
                    { label: 'Notes', value: o.notes },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </QueryState>
    </>
  );
}

function useMutationFactory(fn: () => Promise<unknown>, ok: string, after: () => void) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      after();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

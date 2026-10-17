'use client';

import type { InvoiceItem, InvoiceWithItems } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  FileDown,
  FileMinus,
  Loader2,
  Pencil,
  Save,
  Send,
  Undo2,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { fmtDate, fmtDateTime } from '@/lib/admin/format';
import { INVOICE_STATUS } from '@/lib/admin/status';
import { ActivityLogTable } from '../activity-log';
import { ClientCell } from '../client-cell';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { DescriptionList } from '../description-list';
import { EmailLogTable } from '../email-log';
import { Money, MoneyInput } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { StatusBadge, ToneBadge } from '../status-badge';
import { TransactionTable } from '../transactions/transaction-table';
import { InvoiceLineEditor, type LineDraft } from './invoice-line-editor';
import { isOverdue } from './invoice-table';

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoices', id], queryFn: () => adminApi.invoices.get(id) });
  const inv = q.data?.data;
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
  };
  const issue = useInvoiceMutation(() => adminApi.invoices.issue(id), 'Invoice issued', invalidate);
  const cancel = useInvoiceMutation(
    () => adminApi.invoices.cancel(id),
    'Invoice cancelled',
    invalidate,
  );
  const send = useInvoiceMutation(
    () => adminApi.invoices.send(id),
    'Invoice emailed to the client',
    invalidate,
  );

  return (
    <>
      <AdminPageHeader
        crumbs={[{ label: 'Invoices', href: '/admin/invoices' }, { label: inv?.number ?? 'Draft' }]}
        title={inv ? (inv.number ? `Invoice ${inv.number}` : 'Draft invoice') : 'Invoice'}
        description={inv ? <ClientCell id={inv.clientId} /> : undefined}
        badges={
          inv ? (
            <>
              <StatusBadge value={inv.status} map={INVOICE_STATUS} />
              {isOverdue(inv) ? <ToneBadge tone="danger">Overdue</ToneBadge> : null}
              {inv.reverseCharge ? <ToneBadge tone="info">Reverse charge</ToneBadge> : null}
            </>
          ) : null
        }
        actions={
          inv ? (
            <>
              {inv.status === 'draft' ? (
                <ConfirmButton
                  title="Issue this invoice?"
                  description="A sequential invoice number is assigned, credit balance is applied and the client is emailed. Items can no longer be edited."
                  confirmLabel="Issue"
                  onConfirm={() => issue.mutateAsync()}
                  loading={issue.isPending}
                >
                  <CheckCircle2 /> Issue
                </ConfirmButton>
              ) : null}
              {inv.status === 'unpaid' || inv.status === 'collections' ? (
                <>
                  <Button onClick={() => setPayOpen(true)}>
                    <CheckCircle2 /> Mark paid
                  </Button>
                  <Button variant="outline" onClick={() => send.mutate()} disabled={send.isPending}>
                    <Send /> Send
                  </Button>
                </>
              ) : null}
              {inv.status === 'paid' ? (
                <>
                  <Button variant="outline" onClick={() => setRefundOpen(true)}>
                    <Undo2 /> Refund
                  </Button>
                  <Button variant="outline" onClick={() => setCreditOpen(true)}>
                    <FileMinus /> Credit note
                  </Button>
                  <Button variant="outline" onClick={() => send.mutate()} disabled={send.isPending}>
                    <Send /> Send
                  </Button>
                </>
              ) : null}
              {inv.status !== 'draft' ? (
                <Button asChild variant="outline">
                  <a href={adminApi.invoices.pdfUrl(id)} target="_blank" rel="noreferrer">
                    <FileDown /> PDF
                  </a>
                </Button>
              ) : null}
              {inv.status === 'draft' || inv.status === 'unpaid' ? (
                <ConfirmButton
                  variant="outline"
                  title="Cancel this invoice?"
                  description={
                    inv.status === 'draft'
                      ? 'The draft is discarded.'
                      : 'The invoice number stays reserved (gap-free numbering); a cancelled invoice cannot be reopened.'
                  }
                  destructive
                  confirmLabel="Cancel invoice"
                  onConfirm={() => cancel.mutateAsync()}
                >
                  <Ban /> Cancel
                </ConfirmButton>
              ) : null}
            </>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {inv ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {inv.status === 'draft' ? (
                    <DraftItems invoice={inv} />
                  ) : (
                    <ReadOnlyItems invoice={inv} />
                  )}
                </CardContent>
              </Card>
              <Tabs defaultValue="transactions">
                <TabsList variant="line">
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  <TabsTrigger value="emails">Emails</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="transactions" className="mt-4">
                  <TransactionTable clientId={inv.clientId} invoiceId={inv.id} />
                </TabsContent>
                <TabsContent value="emails" className="mt-4">
                  <EmailLogTable relatedType="invoice" relatedId={inv.id} />
                </TabsContent>
                <TabsContent value="activity" className="mt-4">
                  <ActivityLogTable entityType="invoice" entityId={inv.id} />
                </TabsContent>
              </Tabs>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <DescriptionList
                    columns={1}
                    items={[
                      { label: 'Issue date', value: fmtDate(inv.issueDate) },
                      { label: 'Due date', value: fmtDate(inv.dueDate) },
                      { label: 'Paid at', value: fmtDateTime(inv.paidAt) },
                      { label: 'Sent at', value: fmtDateTime(inv.sentAt) },
                      {
                        label: 'Tax rate',
                        value: inv.reverseCharge ? 'Reverse charge (0%)' : `${inv.taxRate}%`,
                      },
                    ]}
                  />
                  <dl className="mt-4 grid grid-cols-2 gap-y-1 border-t pt-4 text-sm">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="text-right">
                      <Money amount={inv.subtotal} currency={inv.currency} />
                    </dd>
                    {(inv.taxSummary ?? []).length > 1 ? (
                      inv.taxSummary?.map((t) => (
                        <TaxLine key={t.rate} rate={t.rate} tax={t.tax} currency={inv.currency} />
                      ))
                    ) : (
                      <>
                        <dt className="text-muted-foreground">VAT</dt>
                        <dd className="text-right">
                          <Money amount={inv.taxTotal} currency={inv.currency} />
                        </dd>
                      </>
                    )}
                    {inv.creditApplied ? (
                      <>
                        <dt className="text-muted-foreground">Credit applied</dt>
                        <dd className="text-right">
                          <Money amount={-inv.creditApplied} currency={inv.currency} />
                        </dd>
                      </>
                    ) : null}
                    <dt className="font-medium text-base">Total</dt>
                    <dd className="text-right font-medium text-base">
                      <Money amount={inv.total} currency={inv.currency} />
                    </dd>
                  </dl>
                </CardContent>
              </Card>
              <NotesCard invoice={inv} />
            </div>
          </div>
        ) : null}
      </QueryState>
      {payOpen && inv ? (
        <MarkPaidDialog invoice={inv} onClose={() => setPayOpen(false)} onDone={invalidate} />
      ) : null}
      {refundOpen && inv ? (
        <RefundDialog invoice={inv} onClose={() => setRefundOpen(false)} onDone={invalidate} />
      ) : null}
      {creditOpen && inv ? (
        <CreditNoteDialog invoice={inv} onClose={() => setCreditOpen(false)} onDone={invalidate} />
      ) : null}
    </>
  );
}

function TaxLine({ rate, tax, currency }: { rate: string; tax: number; currency: string }) {
  return (
    <>
      <dt className="text-muted-foreground">VAT {rate}%</dt>
      <dd className="text-right">
        <Money amount={tax} currency={currency} />
      </dd>
    </>
  );
}

function useInvoiceMutation(fn: () => Promise<unknown>, ok: string, after: () => void) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      after();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function ReadOnlyItems({ invoice }: { invoice: InvoiceWithItems }) {
  const columns: Column<InvoiceItem>[] = [
    {
      id: 'desc',
      header: 'Description',
      className: 'whitespace-normal',
      cell: (i) => (
        <div>
          {i.description}
          {i.periodStart ? (
            <div className="text-muted-foreground text-xs">
              {fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}
            </div>
          ) : null}
        </div>
      ),
    },
    { id: 'qty', header: 'Qty', align: 'right', cell: (i) => i.quantity },
    {
      id: 'unit',
      header: 'Unit',
      align: 'right',
      hideBelow: 'sm',
      cell: (i) => <Money amount={i.unitAmount} currency={invoice.currency} />,
    },
    { id: 'tax', header: 'VAT', align: 'right', hideBelow: 'sm', cell: (i) => `${i.taxRate}%` },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (i) => <Money amount={i.amount} currency={invoice.currency} />,
    },
  ];
  return (
    <SimpleTable
      columns={columns}
      rows={invoice.items}
      rowKey={(i) => i.id}
      emptyTitle="No items"
      dense
    />
  );
}

function DraftItems({ invoice }: { invoice: InvoiceWithItems }) {
  const qc = useQueryClient();
  const toDraft = (items: InvoiceItem[]): LineDraft[] =>
    items.map((i) => ({
      key: i.id,
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unitAmount: i.unitAmount,
      taxRate: i.taxRate,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
    }));
  const [lines, setLines] = useState<LineDraft[]>(toDraft(invoice.items));
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const existing = new Map(invoice.items.map((i) => [i.id, i]));
      const keep = new Set(lines.map((l) => l.id).filter(Boolean));
      for (const i of invoice.items)
        if (!keep.has(i.id)) await adminApi.invoices.items.remove(invoice.id, i.id);
      for (const l of lines) {
        const body = {
          description: l.description,
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          taxRate: l.taxRate,
          periodStart: l.periodStart || null,
          periodEnd: l.periodEnd || null,
        };
        if (!l.id) await adminApi.invoices.items.add(invoice.id, body);
        else {
          const prev = existing.get(l.id);
          if (
            prev &&
            (prev.description !== l.description ||
              prev.quantity !== l.quantity ||
              prev.unitAmount !== l.unitAmount ||
              prev.taxRate !== l.taxRate ||
              prev.periodStart !== (l.periodStart || null) ||
              prev.periodEnd !== (l.periodEnd || null))
          )
            await adminApi.invoices.items.update(invoice.id, l.id, body);
        }
      }
    },
    onSuccess: async () => {
      const fresh = await qc.fetchQuery({
        queryKey: ['invoices', invoice.id],
        queryFn: () => adminApi.invoices.get(invoice.id),
      });
      setLines(toDraft(fresh.data.items));
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Items saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <InvoiceLineEditor
        lines={lines}
        onChange={(l) => {
          setLines(l);
          setDirty(true);
        }}
        currency={invoice.currency}
        defaultTaxRate={invoice.taxRate}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending || lines.some((l) => !l.description.trim())}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save items
        </Button>
      </div>
    </div>
  );
}

function NotesCard({ invoice }: { invoice: InvoiceWithItems }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? '');
  const m = useMutation({
    mutationFn: () =>
      adminApi.invoices.update(invoice.id, {
        notes: notes || null,
        ...(dueDate ? { dueDate } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', invoice.id] });
      setEditing(false);
      toast.success('Invoice updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const editable = invoice.status === 'draft' || invoice.status === 'unpaid';
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Notes & due date</CardTitle>
        {editable && !editing ? (
          <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {editing ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-notes">Notes</Label>
              <Textarea
                id="inv-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <p className={invoice.notes ? 'whitespace-pre-wrap' : 'text-muted-foreground'}>
            {invoice.notes || 'No notes.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MarkPaidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceWithItems;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(invoice.total);
  const [gateway, setGateway] = useState('manual');
  const [ref, setRef] = useState('');
  const [desc, setDesc] = useState('');
  const m = useMutation({
    mutationFn: () =>
      adminApi.invoices.markPaid(invoice.id, {
        amount,
        gateway,
        gatewayTxnId: ref || null,
        description: desc || null,
        fee: 0,
      }),
    onSuccess: () => {
      toast.success('Payment recorded');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Creates a payment transaction. Overpayments are added to the client's credit balance.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Amount</Label>
            <MoneyInput value={amount} onChange={setAmount} currency={invoice.currency} />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={gateway} onValueChange={setGateway}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['manual', 'bank_transfer', 'cash', 'stripe', 'mollie', 'paypal', 'btcpay'].map(
                  (g) => (
                    <SelectItem key={g} value={g}>
                      {g.replace('_', ' ')}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input
              id="pay-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Bank reference"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-desc">Description</Label>
            <Input id="pay-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || amount <= 0}>
            {m.isPending ? <Loader2 className="animate-spin" /> : null} Mark as paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceWithItems;
  onClose: () => void;
  onDone: () => void;
}) {
  const txns = useQuery({
    queryKey: ['transactions', { invoiceId: invoice.id, type: 'payment' }],
    queryFn: () =>
      adminApi.transactions.list({ invoiceId: invoice.id, type: 'payment', perPage: 50 }),
  });
  const [transactionId, setTransactionId] = useState<string>('');
  const [amount, setAmount] = useState(invoice.total);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      adminApi.invoices.refund(invoice.id, {
        transactionId: transactionId || undefined,
        amount,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      toast.success('Refund recorded');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund invoice {invoice.number}</DialogTitle>
          <DialogDescription>
            Gateways that support refunds are called by the worker; manual payments get a refund
            transaction only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Payment to refund</Label>
            <Select
              value={transactionId}
              onValueChange={(v) => {
                setTransactionId(v);
                const t = txns.data?.data.find((x) => x.id === v);
                if (t) setAmount(t.amount);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={txns.isPending ? 'Loading…' : 'Select payment (optional)'}
                />
              </SelectTrigger>
              <SelectContent>
                {(txns.data?.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.gateway} · {fmtDateTime(t.createdAt)} · {(t.amount / 100).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount</Label>
            <MoneyInput value={amount} onChange={setAmount} currency={invoice.currency} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="refund-reason">Reason</Label>
            <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => m.mutate()}
            disabled={m.isPending || amount <= 0}
          >
            {m.isPending ? <Loader2 className="animate-spin" /> : null} Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditNoteDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceWithItems;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [addToCredit, setAddToCredit] = useState(true);
  const m = useMutation({
    mutationFn: () =>
      adminApi.invoices.creditNote(invoice.id, { reason, addToCreditBalance: addToCredit }),
    onSuccess: () => {
      toast.success('Credit note issued');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue credit note</DialogTitle>
          <DialogDescription>
            Credits the full invoice {invoice.number}. The credit note gets its own sequential
            number and PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cn-reason">Reason</Label>
            <Textarea
              id="cn-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label>Add to client credit balance</Label>
              <p className="text-muted-foreground text-xs">Otherwise refund manually.</p>
            </div>
            <Switch checked={addToCredit} onCheckedChange={setAddToCredit} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !reason.trim()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : null} Issue credit note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

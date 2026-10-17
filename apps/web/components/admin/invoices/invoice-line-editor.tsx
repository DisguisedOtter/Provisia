'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Money, MoneyInput } from '../money';

export interface LineDraft {
  key: string;
  id?: string;
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export function newLine(taxRate = '21.00'): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    description: '',
    quantity: 1,
    unitAmount: 0,
    taxRate,
  };
}

export function lineTotals(lines: LineDraft[], currency = 'EUR') {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const net = l.quantity * l.unitAmount;
    subtotal += net;
    tax += Math.round(net * (Number.parseFloat(l.taxRate || '0') / 100));
  }
  return { subtotal, tax, total: subtotal + tax, currency };
}

/** Editable invoice line table used by the manual invoice form and draft invoices. */
export function InvoiceLineEditor({
  lines,
  onChange,
  currency = 'EUR',
  defaultTaxRate = '21.00',
  readOnly,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  currency?: string;
  defaultTaxRate?: string;
  readOnly?: boolean;
}) {
  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = lineTotals(lines, currency);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Description</TableHead>
              <TableHead className="w-20 text-right">Qty</TableHead>
              <TableHead className="w-36 text-right">Unit price</TableHead>
              <TableHead className="w-24 text-right">VAT %</TableHead>
              <TableHead className="hidden w-44 lg:table-cell">Period</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
              {readOnly ? null : <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.key}>
                <TableCell>
                  <Input
                    value={l.description}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    placeholder="Line description"
                    disabled={readOnly}
                    aria-label="Description"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      update(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="text-right"
                    disabled={readOnly}
                    aria-label="Quantity"
                  />
                </TableCell>
                <TableCell>
                  <MoneyInput
                    value={l.unitAmount}
                    onChange={(v) => update(l.key, { unitAmount: v })}
                    currency={currency}
                    disabled={readOnly}
                    aria-label="Unit price"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={l.taxRate}
                    onChange={(e) => update(l.key, { taxRate: e.target.value })}
                    className="text-right"
                    disabled={readOnly}
                    aria-label="VAT rate"
                    inputMode="decimal"
                  />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex gap-1">
                    <Input
                      type="date"
                      value={l.periodStart ?? ''}
                      onChange={(e) => update(l.key, { periodStart: e.target.value || null })}
                      disabled={readOnly}
                      aria-label="Period start"
                    />
                    <Input
                      type="date"
                      value={l.periodEnd ?? ''}
                      onChange={(e) => update(l.key, { periodEnd: e.target.value || null })}
                      disabled={readOnly}
                      aria-label="Period end"
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Money amount={l.quantity * l.unitAmount} currency={currency} />
                </TableCell>
                {readOnly ? null : (
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove line"
                      onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                      disabled={lines.length <= 1}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {readOnly ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...lines, newLine(defaultTaxRate)])}
          >
            <Plus /> Add line
          </Button>
        )}
        <dl className="grid w-64 grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right">
            <Money amount={totals.subtotal} currency={currency} />
          </dd>
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="text-right">
            <Money amount={totals.tax} currency={currency} />
          </dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium">
            <Money amount={totals.total} currency={currency} />
          </dd>
        </dl>
      </div>
    </div>
  );
}

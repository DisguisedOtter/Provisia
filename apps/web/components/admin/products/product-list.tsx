'use client';

import type { ProductGroup, ProductWithPrices } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi } from '@/lib/admin/api';
import { errorMessage } from '@/lib/admin/form-errors';
import { BILLING_CYCLE_LABELS } from '@/lib/admin/format';
import { ConfirmButton } from '../confirm-dialog';
import { type Column, SimpleTable } from '../data-table';
import { EmptyState } from '../empty-state';
import { Money } from '../money';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { GroupDialog } from './group-dialog';

export function ProductList() {
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ['product-groups'],
    queryFn: () => adminApi.productGroups.list(),
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => adminApi.products.list({ perPage: 100 }),
  });
  const [editGroup, setEditGroup] = useState<ProductGroup | 'new' | null>(null);
  const removeGroup = useMutation({
    mutationFn: (id: string) => adminApi.productGroups.remove(id),
    onSuccess: () => {
      toast.success('Group deleted');
      qc.invalidateQueries({ queryKey: ['product-groups'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeProduct = useMutation({
    mutationFn: (id: string) => adminApi.products.remove(id),
    onSuccess: () => {
      toast.success('Product deleted');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<ProductWithPrices>[] = [
    {
      id: 'name',
      header: 'Product',
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          {p.name}
          {p.hidden ? (
            <EyeOff className="size-3.5 text-muted-foreground" aria-label="Hidden" />
          ) : null}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      hideBelow: 'sm',
      cell: (p) => (
        <Badge variant="outline" className="capitalize">
          {p.type}
        </Badge>
      ),
    },
    {
      id: 'module',
      header: 'Module',
      hideBelow: 'md',
      cell: (p) => p.module ?? <span className="text-muted-foreground">none</span>,
    },
    {
      id: 'prices',
      header: 'Pricing',
      cell: (p) => {
        const monthly = p.prices.find((x) => x.billingCycle === 'monthly') ?? p.prices[0];
        if (!monthly) return <span className="text-muted-foreground">No prices</span>;
        return (
          <span>
            <Money amount={monthly.recurring} currency={monthly.currency} />{' '}
            <span className="text-muted-foreground text-xs">
              / {BILLING_CYCLE_LABELS[monthly.billingCycle].toLowerCase()}
            </span>
            {p.prices.length > 1 ? (
              <span className="text-muted-foreground text-xs"> +{p.prices.length - 1}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'stock',
      header: 'Stock',
      hideBelow: 'lg',
      cell: (p) => (p.stockControl ? p.stock : <span className="text-muted-foreground">∞</span>),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <ConfirmButton
          variant="ghost"
          size="icon-sm"
          aria-label="Delete product"
          title={`Delete ${p.name}?`}
          description="Products with existing services cannot be deleted; hide them instead."
          destructive
          confirmLabel="Delete"
          onConfirm={() => removeProduct.mutateAsync(p.id)}
        >
          <Trash2 />
        </ConfirmButton>
      ),
    },
  ];

  const byGroup = new Map<string, ProductWithPrices[]>();
  for (const p of products.data?.data ?? []) {
    const arr = byGroup.get(p.groupId) ?? [];
    arr.push(p);
    byGroup.set(p.groupId, arr);
  }

  return (
    <>
      <AdminPageHeader
        title="Products"
        crumbs={[{ label: 'Products' }]}
        description="Product groups appear as categories in the order form."
        actions={
          <>
            <Button variant="outline" onClick={() => setEditGroup('new')}>
              <FolderPlus /> New group
            </Button>
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus /> New product
              </Link>
            </Button>
          </>
        }
      />
      <QueryState
        isPending={groups.isPending || products.isPending}
        error={groups.error ?? products.error}
        refetch={() => {
          groups.refetch();
          products.refetch();
        }}
      >
        {groups.data && groups.data.data.length === 0 ? (
          <EmptyState
            title="No product groups yet"
            description="Create a group (e.g. Shared hosting, VPS) and add products to it."
            action={
              <Button onClick={() => setEditGroup('new')}>
                <FolderPlus /> New group
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {[...(groups.data?.data ?? [])]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((g) => (
                <Card key={g.id} className="gap-3 py-4">
                  <CardHeader className="flex flex-row items-center justify-between px-4">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {g.name}
                        {g.hidden ? <Badge variant="outline">Hidden</Badge> : null}
                      </CardTitle>
                      {g.description ? (
                        <p className="text-muted-foreground text-sm">{g.description}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/products/new?groupId=${g.id}`}>
                          <Plus /> Product
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit group"
                        onClick={() => setEditGroup(g)}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete group"
                        title={`Delete group ${g.name}?`}
                        description="Only empty groups can be deleted."
                        destructive
                        confirmLabel="Delete"
                        onConfirm={() => removeGroup.mutateAsync(g.id)}
                      >
                        <Trash2 />
                      </ConfirmButton>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4">
                    <SimpleTable
                      columns={columns}
                      rows={byGroup.get(g.id) ?? []}
                      rowKey={(p) => p.id}
                      rowHref={(p) => `/admin/products/${p.id}`}
                      emptyTitle="No products in this group"
                      dense
                    />
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </QueryState>
      {editGroup ? (
        <GroupDialog
          group={editGroup === 'new' ? null : editGroup}
          onClose={() => setEditGroup(null)}
        />
      ) : null}
    </>
  );
}

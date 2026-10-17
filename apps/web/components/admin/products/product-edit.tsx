'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { adminApi } from '@/lib/admin/api';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { ProductForm } from './product-form';

export function ProductEdit() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['products', id], queryFn: () => adminApi.products.get(id) });
  return (
    <>
      <AdminPageHeader
        title={q.data?.data.name ?? 'Product'}
        crumbs={[
          { label: 'Products', href: '/admin/products' },
          { label: q.data?.data.name ?? '…' },
        ]}
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data ? <ProductForm product={q.data.data} /> : null}
      </QueryState>
    </>
  );
}

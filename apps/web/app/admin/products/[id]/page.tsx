import { Suspense } from 'react';
import { ProductEdit } from '@/components/admin/products/product-edit';

export const metadata = { title: 'Product' };

export default function Page() {
  return (
    <Suspense>
      <ProductEdit />
    </Suspense>
  );
}

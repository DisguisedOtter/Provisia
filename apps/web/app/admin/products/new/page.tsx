import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/admin/page-header';
import { ProductForm } from '@/components/admin/products/product-form';

export const metadata = { title: 'New product' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="New product"
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: 'New' }]}
      />
      <Suspense>
        <ProductForm />
      </Suspense>
    </>
  );
}

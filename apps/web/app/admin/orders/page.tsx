import { Suspense } from 'react';
import { OrderTable } from '@/components/admin/orders/order-table';
import { AdminPageHeader } from '@/components/admin/page-header';

export const metadata = { title: 'Orders' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="Orders"
        crumbs={[{ label: 'Orders' }]}
        description="Pending orders need review before services are provisioned."
      />
      <Suspense>
        <OrderTable />
      </Suspense>
    </>
  );
}

import { Suspense } from 'react';
import { InvoiceDetail } from '@/components/admin/invoices/invoice-detail';

export const metadata = { title: 'Invoice' };

export default function Page() {
  return (
    <Suspense>
      <InvoiceDetail />
    </Suspense>
  );
}

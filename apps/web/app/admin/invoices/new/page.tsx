import { Suspense } from 'react';
import { InvoiceNew } from '@/components/admin/invoices/invoice-new';

export const metadata = { title: 'New invoice' };

export default function Page() {
  return (
    <Suspense>
      <InvoiceNew />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { ListSkeleton } from '@/components/portal/skeletons';
import { InvoicesListView } from '@/components/portal/views/invoices-list';

export const metadata = { title: 'Invoices' };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <InvoicesListView />
    </Suspense>
  );
}

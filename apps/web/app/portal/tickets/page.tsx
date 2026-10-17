import { Suspense } from 'react';
import { ListSkeleton } from '@/components/portal/skeletons';
import { TicketsListView } from '@/components/portal/views/tickets-list';

export const metadata = { title: 'Tickets' };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <TicketsListView />
    </Suspense>
  );
}

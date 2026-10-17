import { Suspense } from 'react';
import { ListSkeleton } from '@/components/portal/skeletons';
import { ServicesListView } from '@/components/portal/views/services-list';

export const metadata = { title: 'Services' };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ServicesListView />
    </Suspense>
  );
}

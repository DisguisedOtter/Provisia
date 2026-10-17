import { Suspense } from 'react';
import { ListSkeleton } from '@/components/portal/skeletons';
import { DomainsListView } from '@/components/portal/views/domains-list';

export const metadata = { title: 'Domains' };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <DomainsListView />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { DetailSkeleton } from '@/components/portal/skeletons';
import { DomainDetailView } from '@/components/portal/views/domain-detail';

export const metadata = { title: 'Domain' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <DomainDetailView id={id} />
    </Suspense>
  );
}

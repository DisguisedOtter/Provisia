import { Suspense } from 'react';
import { DetailSkeleton } from '@/components/portal/skeletons';
import { InvoiceDetailView } from '@/components/portal/views/invoice-detail';

export const metadata = { title: 'Invoice' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <InvoiceDetailView id={id} />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { DetailSkeleton } from '@/components/portal/skeletons';
import { PaymentReturnView } from '@/components/portal/views/payment-return';

export const metadata = { title: 'Payment' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PaymentReturnView invoiceId={id} />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { FormSkeleton } from '@/components/portal/skeletons';
import { TicketNewView } from '@/components/portal/views/ticket-new';

export const metadata = { title: 'Open ticket' };

export default function Page() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TicketNewView />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { TicketNew } from '@/components/admin/tickets/ticket-new';

export const metadata = { title: 'New ticket' };

export default function Page() {
  return (
    <Suspense>
      <TicketNew />
    </Suspense>
  );
}

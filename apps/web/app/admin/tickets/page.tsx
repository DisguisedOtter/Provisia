import { Plus, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/admin/page-header';
import { TicketTable } from '@/components/admin/tickets/ticket-table';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Tickets' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="Tickets"
        crumbs={[{ label: 'Tickets' }]}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/settings/departments">
                <Settings2 /> Departments
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/tickets/new">
                <Plus /> New ticket
              </Link>
            </Button>
          </>
        }
      />
      <Suspense>
        <TicketTable />
      </Suspense>
    </>
  );
}

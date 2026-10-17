import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { InvoiceTable } from '@/components/admin/invoices/invoice-table';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Invoices' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="Invoices"
        crumbs={[{ label: 'Invoices' }]}
        actions={
          <Button asChild>
            <Link href="/admin/invoices/new">
              <Plus /> New invoice
            </Link>
          </Button>
        }
      />
      <Suspense>
        <InvoiceTable />
      </Suspense>
    </>
  );
}

import { Tags } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { DomainTable } from '@/components/admin/domains/domain-table';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Domains' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="Domains"
        crumbs={[{ label: 'Domains' }]}
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/domains/tlds">
              <Tags /> TLD pricing
            </Link>
          </Button>
        }
      />
      <Suspense>
        <DomainTable />
      </Suspense>
    </>
  );
}

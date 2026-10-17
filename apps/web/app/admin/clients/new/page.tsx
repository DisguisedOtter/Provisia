import { ClientForm } from '@/components/admin/clients/client-form';
import { AdminPageHeader } from '@/components/admin/page-header';

export const metadata = { title: 'New client' };

export default function Page() {
  return (
    <>
      <AdminPageHeader
        title="New client"
        crumbs={[{ label: 'Clients', href: '/admin/clients' }, { label: 'New' }]}
      />
      <ClientForm />
    </>
  );
}

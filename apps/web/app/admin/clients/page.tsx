import { Suspense } from 'react';
import { ClientList } from '@/components/admin/clients/client-list';

export const metadata = { title: 'Clients' };

export default function Page() {
  return (
    <Suspense>
      <ClientList />
    </Suspense>
  );
}

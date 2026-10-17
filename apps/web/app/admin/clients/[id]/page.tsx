import { Suspense } from 'react';
import { ClientDetail } from '@/components/admin/clients/client-detail';

export const metadata = { title: 'Client' };

export default function Page() {
  return (
    <Suspense>
      <ClientDetail />
    </Suspense>
  );
}

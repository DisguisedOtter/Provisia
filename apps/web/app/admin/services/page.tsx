import { Suspense } from 'react';
import { ServiceList } from '@/components/admin/services/service-list';

export const metadata = { title: 'Services' };

export default function Page() {
  return (
    <Suspense>
      <ServiceList />
    </Suspense>
  );
}

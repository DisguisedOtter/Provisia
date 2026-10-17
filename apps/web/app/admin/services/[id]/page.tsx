import { Suspense } from 'react';
import { ServiceDetail } from '@/components/admin/services/service-detail';

export const metadata = { title: 'Service' };

export default function Page() {
  return (
    <Suspense>
      <ServiceDetail />
    </Suspense>
  );
}

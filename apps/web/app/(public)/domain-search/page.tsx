import { Suspense } from 'react';
import { DomainSearchPageView } from '@/components/portal/views/domain-search-page';

export const metadata = { title: 'Domain search' };

export default function Page() {
  return (
    <Suspense>
      <DomainSearchPageView />
    </Suspense>
  );
}

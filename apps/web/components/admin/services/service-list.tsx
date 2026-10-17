'use client';

import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AdminPageHeader } from '../page-header';
import { ServiceDialog } from './service-dialog';
import { ServiceTable } from './service-table';

export function ServiceList() {
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(sp.get('new') === '1');
  const clientId = sp.get('clientId') ?? undefined;
  return (
    <>
      <AdminPageHeader
        title="Services"
        crumbs={[{ label: 'Services' }]}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New service
          </Button>
        }
      />
      <ServiceTable clientId={clientId} />
      {open ? (
        <ServiceDialog
          clientId={clientId}
          onClose={() => {
            setOpen(false);
            if (sp.get('new')) router.replace('/admin/services');
          }}
        />
      ) : null}
    </>
  );
}

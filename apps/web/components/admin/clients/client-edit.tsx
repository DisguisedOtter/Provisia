'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { adminApi } from '@/lib/admin/api';
import { clientDisplayName } from '@/lib/admin/format';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { ClientForm } from './client-form';

export function ClientEdit() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['clients', id], queryFn: () => adminApi.clients.get(id) });
  return (
    <>
      <AdminPageHeader
        title="Edit client"
        crumbs={[
          { label: 'Clients', href: '/admin/clients' },
          { label: q.data ? clientDisplayName(q.data.data) : '…', href: `/admin/clients/${id}` },
          { label: 'Edit' },
        ]}
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data ? <ClientForm client={q.data.data} /> : null}
      </QueryState>
    </>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin/api';
import { clientDisplayName } from '@/lib/admin/format';

/** Resolves a client id to a linked display name (cached per id). */
export function ClientCell({ id, link = true }: { id: string | null | undefined; link?: boolean }) {
  const q = useQuery({
    queryKey: ['clients', id],
    queryFn: () => adminApi.clients.get(id as string),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!id) return <span className="text-muted-foreground">—</span>;
  if (q.isPending) return <Skeleton className="h-4 w-28" />;
  const name = q.data ? clientDisplayName(q.data.data) : `Client ${id.slice(0, 8)}`;
  return link ? (
    <Link href={`/admin/clients/${id}`} className="hover:underline">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

export function ProductCell({ id }: { id: string | null | undefined }) {
  const q = useQuery({
    queryKey: ['products', 'lookup'],
    queryFn: () => adminApi.lookup.products(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!id) return <span className="text-muted-foreground">—</span>;
  const p = q.data?.data.find((x) => x.id === id);
  if (q.isPending) return <Skeleton className="h-4 w-24" />;
  return <span>{p?.name ?? `Product ${id.slice(0, 8)}`}</span>;
}

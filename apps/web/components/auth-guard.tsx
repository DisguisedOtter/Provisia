'use client';

import type { UserRole } from '@provisia/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/auth';

/** Client-side guard: waits for /auth/me, redirects to /login on 401 and to the right area on role mismatch. */
export function AuthGuard({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const router = useRouter();
  const { data: me, isPending } = useMe();

  useEffect(() => {
    if (isPending) return;
    if (!me) router.replace('/login');
    else if (!roles.includes(me.role)) router.replace(me.role === 'client' ? '/portal' : '/admin');
  }, [me, isPending, roles, router]);

  if (isPending || !me || !roles.includes(me.role)) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}

'use client';

import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMe, useStopImpersonation } from '@/lib/auth';

/** Shown above the portal while an admin is logged in as a client. */
export function ImpersonationBanner() {
  const { data: me } = useMe();
  const stop = useStopImpersonation();
  if (!me?.impersonator) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-amber-950 text-sm">
      <span className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" />
        You ({me.impersonator.email}) are logged in as <strong>{me.email}</strong>. Actions are
        audited.
      </span>
      <Button size="sm" variant="secondary" onClick={() => stop.mutate()} disabled={stop.isPending}>
        {stop.isPending ? 'Returning…' : 'Return to admin'}
      </Button>
    </div>
  );
}

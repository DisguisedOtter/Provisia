'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { EmptyState } from '@/components/portal/empty-state';
import { Button } from '@/components/ui/button';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description={error.message}
      action={
        <Button variant="outline" onClick={reset}>
          Retry
        </Button>
      }
    />
  );
}

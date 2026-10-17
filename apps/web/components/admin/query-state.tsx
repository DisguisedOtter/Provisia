'use client';

import { AlertTriangle, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isMissingEndpoint } from '@/lib/admin/form-errors';
import { EmptyState } from './empty-state';

/** Loading / error / not-implemented states for a query. Renders children when data is ready. */
export function QueryState({
  isPending,
  error,
  refetch,
  children,
  skeleton,
  compact,
}: {
  isPending: boolean;
  error: unknown;
  refetch?: () => void;
  children: React.ReactNode;
  skeleton?: React.ReactNode;
  compact?: boolean;
}) {
  if (isPending) {
    return (
      <>
        {skeleton ?? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
            {compact ? null : <Skeleton className="h-24 w-full" />}
          </div>
        )}
      </>
    );
  }
  if (error) {
    if (isMissingEndpoint(error)) {
      return (
        <EmptyState
          icon={PlugZap}
          title="Not available yet"
          description="This part of the API is not implemented yet. The page will light up as soon as the backend route exists."
          className={compact ? 'py-6' : undefined}
        />
      );
    }
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Could not load"
        description={errorMessage(error)}
        className={compact ? 'py-6' : undefined}
        action={
          refetch ? (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          ) : null
        }
      />
    );
  }
  return <>{children}</>;
}

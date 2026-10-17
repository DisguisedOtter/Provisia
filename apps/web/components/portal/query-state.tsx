'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState } from './error-boundary';

/**
 * Uniform loading / error / empty / data rendering for a TanStack query.
 * `isEmpty` decides when to show `empty` (defaults to empty arrays and `{data: []}` envelopes).
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  kind,
  compact,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  kind?: 'section' | 'item';
  compact?: boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
        kind={kind}
        compact={compact}
      />
    );
  }
  const data = query.data;
  const emptyCheck =
    isEmpty ??
    ((d: T) =>
      Array.isArray(d)
        ? d.length === 0
        : Boolean(
            d &&
              typeof d === 'object' &&
              'data' in d &&
              Array.isArray((d as { data: unknown[] }).data) &&
              (d as { data: unknown[] }).data.length === 0,
          ));
  if (empty !== undefined && emptyCheck(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}

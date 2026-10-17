'use client';

import { AlertTriangle, Construction, SearchX } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/portal/i18n';
import { EmptyState } from './empty-state';

/** Renders an API error as a friendly block: 404 → "not available yet / not found", else generic. */
export function ErrorState({
  error,
  onRetry,
  kind = 'section',
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  /** `section`: a list/collection that may not exist yet; `item`: a single resource. */
  kind?: 'section' | 'item';
  compact?: boolean;
}) {
  const t = useT();
  if (error instanceof ApiError && error.status === 404) {
    return kind === 'section' ? (
      <EmptyState
        compact={compact}
        icon={Construction}
        title={t('common.unavailable')}
        description={t('common.unavailableHint')}
      />
    ) : (
      <EmptyState
        compact={compact}
        icon={SearchX}
        title={t('common.notFound')}
        description={t('common.notFoundHint')}
      />
    );
  }
  const message = error instanceof Error ? error.message : undefined;
  return (
    <EmptyState
      compact={compact}
      icon={AlertTriangle}
      title={t('common.somethingWrong')}
      description={message && message !== 'Failed to fetch' ? message : t('common.errorHint')}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}

interface BoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

/** Catches render errors in a subtree so one broken widget does not take the whole page down. */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[portal] render error', error);
  }

  reset = () => this.setState({ error: null });

  override render() {
    if (this.state.error) {
      return this.props.fallback ? (
        this.props.fallback(this.state.error, this.reset)
      ) : (
        <ErrorState error={this.state.error} onRetry={this.reset} />
      );
    }
    return this.props.children;
  }
}

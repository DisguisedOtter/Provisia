'use client';

import { Badge } from '@/components/ui/badge';
import type { DictKey } from '@/lib/portal/dictionary';
import { useT } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<string, Tone> = {
  active: 'success',
  paid: 'success',
  running: 'success',
  sent: 'success',
  answered: 'info',
  open: 'info',
  customer_reply: 'warning',
  pending: 'warning',
  pending_transfer: 'warning',
  unpaid: 'warning',
  on_hold: 'neutral',
  draft: 'neutral',
  queued: 'neutral',
  closed: 'neutral',
  inactive: 'neutral',
  stopped: 'neutral',
  onetime: 'neutral',
  suspended: 'danger',
  terminated: 'danger',
  cancelled: 'neutral',
  expired: 'danger',
  transferred_away: 'neutral',
  refunded: 'info',
  collections: 'danger',
  overdue: 'danger',
  failed: 'danger',
  bounced: 'danger',
  fraud: 'danger',
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-transparent',
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  warning:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  danger:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900',
  info: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
};

/** Coloured pill for any domain status enum; the label is translated via `status.<value>`. */
export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const tone = TONES[status] ?? 'neutral';
  const key = `status.${status}` as DictKey;
  const text = label ?? t(key);
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', TONE_CLASS[tone], className)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          tone === 'success' && 'bg-emerald-500',
          tone === 'warning' && 'bg-amber-500',
          tone === 'danger' && 'bg-red-500',
          tone === 'info' && 'bg-sky-500',
          tone === 'neutral' && 'bg-muted-foreground/60',
        )}
      />
      {text === key ? status : text}
    </Badge>
  );
}

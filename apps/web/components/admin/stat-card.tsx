import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  loading,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  loading?: boolean;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const body = (
    <CardContent className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
          <div
            className={cn(
              'mt-1 truncate font-semibold text-2xl tabular-nums',
              tone === 'warning' && 'text-amber-600 dark:text-amber-400',
              tone === 'danger' && 'text-red-600 dark:text-red-400',
              tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {value}
          </div>
        )}
        {hint ? <div className="mt-1 text-muted-foreground text-xs">{hint}</div> : null}
      </div>
      {Icon ? (
        <div className="rounded-md bg-muted p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      ) : null}
    </CardContent>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Card className="h-full py-0 transition-colors hover:bg-accent/40">{body}</Card>
      </Link>
    );
  }
  return <Card className="h-full py-0">{body}</Card>;
}

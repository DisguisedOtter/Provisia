import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <h3 className="font-medium text-sm">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

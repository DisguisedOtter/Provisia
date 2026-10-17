import { cn } from '@/lib/utils';

export function DescriptionList({
  items,
  className,
  columns = 2,
}: {
  items: Array<{ label: string; value: React.ReactNode; span?: boolean }>;
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3 text-sm',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0', it.span && 'sm:col-span-full')}>
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">{it.label}</dt>
          <dd className="mt-0.5 break-words">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

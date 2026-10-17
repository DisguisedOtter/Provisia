import { cn } from '@/lib/utils';

/** Responsive definition list: stacked on mobile, two columns on larger screens. */
export function KeyValue({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode; hidden?: boolean }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">{i.label}</dt>
            <dd className="mt-0.5 truncate text-sm">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

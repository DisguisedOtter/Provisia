import { Badge } from '@/components/ui/badge';
import { titleCase } from '@/lib/admin/format';
import { TONE_CLASSES, type Tone } from '@/lib/admin/status';
import { cn } from '@/lib/utils';

export function StatusBadge<K extends string>({
  value,
  map,
  className,
}: {
  value: K | string | null | undefined;
  map: Partial<Record<K | string, { label: string; tone: Tone }>>;
  className?: string;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const entry = map[value] ?? { label: titleCase(value), tone: 'neutral' as Tone };
  return (
    <Badge variant="secondary" className={cn('border-0', TONE_CLASSES[entry.tone], className)}>
      {entry.label}
    </Badge>
  );
}

export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn('border-0', TONE_CLASSES[tone], className)}>
      {children}
    </Badge>
  );
}

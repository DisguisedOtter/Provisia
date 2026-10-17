'use client';

import { Check } from 'lucide-react';
import { useI18n } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';

const STEPS = [
  'order.step.product',
  'order.step.configure',
  'order.step.cart',
  'order.step.checkout',
] as const;

export function OrderSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <ol className="mb-6 flex items-center gap-2 overflow-x-auto text-sm">
      {STEPS.map((key, i) => (
        <li key={key} className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full border text-xs',
              i < current && 'border-primary bg-primary text-primary-foreground',
              i === current && 'border-foreground font-medium',
              i > current && 'text-muted-foreground',
            )}
          >
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              'whitespace-nowrap',
              i === current ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {t(key)}
          </span>
          {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-border sm:w-10" /> : null}
        </li>
      ))}
    </ol>
  );
}

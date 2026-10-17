'use client';

import { fmtMoney } from '@/lib/portal/format';
import { useLocale } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';

/** Formats integer minor units in the active locale (`€ 12,34` in NL, `€12.34` in EN). */
export function Money({
  amount,
  currency = 'EUR',
  className,
  signed,
}: {
  amount: number;
  currency?: string;
  className?: string;
  /** Prefix a `+` for positive amounts (credits). */
  signed?: boolean;
}) {
  const locale = useLocale();
  const text = fmtMoney(amount, currency, locale);
  return (
    <span className={cn('tabular-nums', className)}>
      {signed && amount > 0 ? `+${text}` : text}
    </span>
  );
}

export function useMoney() {
  const locale = useLocale();
  return (amount: number, currency = 'EUR') => fmtMoney(amount, currency, locale);
}

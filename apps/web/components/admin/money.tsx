'use client';

import { parseMoney, toDecimalString } from '@provisia/shared';
import { forwardRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/admin/format';
import { cn } from '@/lib/utils';
import { useLocale } from './locale';

/** Formats minor units with the active admin locale. */
export function Money({
  amount,
  currency = 'EUR',
  className,
  signed = false,
}: {
  amount: number;
  currency?: string;
  className?: string;
  signed?: boolean;
}) {
  const [locale] = useLocale();
  const tone =
    signed && amount < 0
      ? 'text-red-600 dark:text-red-400'
      : signed && amount > 0
        ? 'text-emerald-700 dark:text-emerald-400'
        : '';
  return (
    <span className={cn('tabular-nums', tone, className)}>
      {signed && amount > 0 ? '+' : ''}
      {fmtMoney(amount, currency, locale)}
    </span>
  );
}

/**
 * Decimal text input bound to an integer minor-units value. Accepts `12,34` and `12.34`;
 * emits the parsed cents on blur / valid input.
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
    value: number | null | undefined;
    onChange: (cents: number) => void;
    currency?: string;
  }
>(function MoneyInput({ value, onChange, currency = 'EUR', className, ...props }, ref) {
  const [text, setText] = useState(
    value == null ? '' : toDecimalString({ amount: value, currency }),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync the text only when the external value changes
  useEffect(() => {
    const parsed = tryParse(text, currency);
    if (parsed !== value)
      setText(value == null ? '' : toDecimalString({ amount: value, currency }));
  }, [value, currency]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground text-sm">
        {currency === 'EUR' ? '€' : currency}
      </span>
      <Input
        ref={ref}
        inputMode="decimal"
        className={cn('pl-8 text-right tabular-nums', className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = tryParse(e.target.value, currency);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = tryParse(text, currency);
          if (parsed === null) {
            setText(value == null ? '' : toDecimalString({ amount: value, currency }));
          } else {
            setText(toDecimalString({ amount: parsed, currency }));
            onChange(parsed);
          }
        }}
        {...props}
      />
    </div>
  );
});

function tryParse(text: string, currency: string): number | null {
  const t = text.trim();
  if (!t || t === '-' || t.endsWith('.') || t.endsWith(',')) return null;
  try {
    return parseMoney(t, currency).amount;
  } catch {
    return null;
  }
}

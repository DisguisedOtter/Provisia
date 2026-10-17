'use client';

import { Languages } from 'lucide-react';
import { useLocale } from '@/components/admin/locale';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Locale } from '@/lib/admin/format';

export function LocaleToggle() {
  const [locale, setLocale] = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Number and date format">
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <DropdownMenuRadioItem value="nl-NL">Nederlands (€ 1.234,56)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en-GB">English (€1,234.56)</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

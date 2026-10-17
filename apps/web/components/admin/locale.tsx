'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getLocale,
  type Locale,
  loadStoredLocale,
  setLocale,
  subscribeLocale,
} from '@/lib/admin/format';

/** Reactive admin locale (affects money/date formatting only). */
export function useLocale(): [Locale, (l: Locale) => void] {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'nl-NL' as Locale);
  useEffect(() => {
    loadStoredLocale();
    setLocale(getLocale());
  }, []);
  return [locale, setLocale];
}

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type DictKey, dictionaries } from './dictionary';

export type Locale = keyof typeof dictionaries;
export const LOCALES: Locale[] = ['en', 'nl'];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', nl: 'Nederlands' };
const STORAGE_KEY = 'pv_locale';

type Vars = Record<string, string | number>;
export type Translate = (key: DictKey, vars?: Vars) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale, opts?: { persist?: boolean }) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value);
}

/** Maps a client profile language (`nl`, `nl-NL`, `en-GB`, …) onto a supported locale. */
export function localeFromLanguage(language: string | null | undefined): Locale | null {
  if (!language) return null;
  const base = language.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage unavailable (private mode) — fall through
  }
  return localeFromLanguage(window.navigator.language) ?? 'en';
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Render EN on the server and first client paint, then switch to the detected locale to avoid
  // hydration mismatches. The flash is short and the portal pages are behind a loading state anyway.
  const [locale, setLocaleState] = useState<Locale>('en');
  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale, opts?: { persist?: boolean }) => {
    setLocaleState(next);
    if (opts?.persist ?? true) {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(dictionaries[locale][key] ?? dictionaries.en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

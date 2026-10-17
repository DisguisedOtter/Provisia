'use client';

import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/portal/i18n';

/** Theme (class on <html>) + i18n for the portal and the public order pages. */
export function PortalProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

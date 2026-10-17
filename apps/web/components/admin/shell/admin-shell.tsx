'use client';

import { CreditCard, Menu } from 'lucide-react';
import { ThemeProvider } from 'next-themes';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';
import { GlobalSearch } from './global-search';
import { LocaleToggle } from './locale-toggle';
import { NotificationsBell } from './notifications';
import { Sidebar, SidebarNav } from './sidebar';
import { ThemeToggle } from './theme-toggle';

const COLLAPSE_KEY = 'pv_admin_sidebar_collapsed';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {}
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={200}>
        <div className="flex min-h-screen">
          <a
            href="#admin-main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
          >
            Skip to content
          </a>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label="Open navigation"
                  >
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
                  <SheetHeader className="h-14 flex-row items-center gap-2 border-b px-4">
                    <CreditCard className="size-5" />
                    <SheetTitle>Provisia</SheetTitle>
                  </SheetHeader>
                  <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
              <div className="flex flex-1 items-center">
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-1">
                <LocaleToggle />
                <ThemeToggle />
                <NotificationsBell />
                <UserMenu />
              </div>
            </header>
            <main id="admin-main" className="flex-1 p-4 md:p-6" tabIndex={-1}>
              <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

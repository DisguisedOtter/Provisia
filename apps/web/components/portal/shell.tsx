'use client';

import { Menu, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NavLink } from '@/components/nav-link';
import { portalNav } from '@/components/portal-nav';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserMenu } from '@/components/user-menu';
import { useMe } from '@/lib/auth';
import { useCart } from '@/lib/portal/cart';
import { type DictKey, en } from '@/lib/portal/dictionary';
import { useProfileLocaleSync } from '@/lib/portal/hooks';
import { useT } from '@/lib/portal/i18n';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';

const NAV_KEY_BY_HREF: Record<string, DictKey> = {
  '/portal': 'nav.dashboard',
  '/portal/services': 'nav.services',
  '/portal/domains': 'nav.domains',
  '/portal/invoices': 'nav.invoices',
  '/portal/tickets': 'nav.tickets',
  '/portal/account': 'nav.account',
};

function navLabel(t: ReturnType<typeof useT>, href: string, fallback: string) {
  const key = NAV_KEY_BY_HREF[href];
  return key && key in en ? t(key) : fallback;
}

function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground text-xs">
        P
      </span>
      <span>Provisia</span>
    </Link>
  );
}

function CartButton() {
  const { lines } = useCart();
  const t = useT();
  const count = lines.length;
  return (
    <Button variant="ghost" size="icon" asChild aria-label={t('nav.cart')}>
      <Link href="/cart" className="relative">
        <ShoppingCart className="size-4" />
        {count > 0 ? (
          <span className="-top-0.5 -right-0.5 absolute grid size-4 place-items-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground">
            {count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

/** Portal chrome: sticky header, desktop nav, mobile sheet nav, theme + language controls. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useProfileLocaleSync();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30 dark:bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t('nav.openMenu')}
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>{t('nav.menu')}</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-2">
                {portalNav.map(({ href, label }) => (
                  <NavLink
                    key={href}
                    href={href}
                    className="rounded-md px-3 py-2 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
                    activeClassName="bg-accent text-foreground font-medium"
                  >
                    {navLabel(t, href, label)}
                  </NavLink>
                ))}
                <NavLink
                  href="/order"
                  className="rounded-md px-3 py-2 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
                  activeClassName="bg-accent text-foreground font-medium"
                >
                  {t('nav.order')}
                </NavLink>
              </nav>
            </SheetContent>
          </Sheet>
          <Logo href="/portal" />
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {portalNav.map(({ href, label }) => (
              <NavLink
                key={href}
                href={href}
                className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
                activeClassName="bg-accent text-foreground font-medium"
              >
                {navLabel(t, href, label)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/order">{t('nav.order')}</Link>
            </Button>
            <CartButton />
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:py-8">{children}</main>
      <footer className="border-t py-4 text-center text-muted-foreground text-xs">
        Provisia · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

/** Public (order flow) chrome: logo, cart, login/portal link. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { data: me } = useMe();
  return (
    <div className="flex min-h-screen flex-col bg-muted/30 dark:bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Logo href="/order" />
          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            <NavLink
              href="/order"
              className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
              activeClassName="bg-accent text-foreground font-medium"
            >
              {t('nav.order')}
            </NavLink>
            <NavLink
              href="/domain-search"
              className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
              activeClassName="bg-accent text-foreground font-medium"
            >
              {t('nav.domainSearch')}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <CartButton />
            <LanguageSwitcher />
            <ThemeToggle />
            {me ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={me.role === 'client' ? '/portal' : '/admin'}>{t('nav.portal')}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href="/login?next=/portal">{t('nav.login')}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className={cn('mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:py-8')}>{children}</main>
      <footer className="border-t py-4 text-center text-muted-foreground text-xs">
        Provisia · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

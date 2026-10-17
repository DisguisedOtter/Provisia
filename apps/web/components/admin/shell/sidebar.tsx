'use client';

import { CreditCard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { adminNav } from '@/components/admin-nav';
import { NavLink } from '@/components/nav-link';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Main">
      {adminNav.map(({ href, label, icon: Icon }) => {
        const link = (
          <NavLink
            key={href}
            href={href}
            onClick={collapsed ? undefined : onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              collapsed && 'justify-center px-2',
            )}
            activeClassName="bg-sidebar-accent font-medium"
          >
            <Icon className="size-4 shrink-0" />
            {collapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
          </NavLink>
        );
        if (!collapsed) return link;
        return (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b px-4 font-semibold',
          collapsed && 'justify-center px-0',
        )}
      >
        <CreditCard className="size-5 shrink-0" />
        {collapsed ? null : <span>Provisia</span>}
      </div>
      <SidebarNav collapsed={collapsed} />
      <div
        className={cn(
          'flex items-center gap-2 border-t p-2',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {collapsed ? null : (
          <Link href="/portal" className="px-2 text-muted-foreground text-xs hover:underline">
            Client portal
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
    </aside>
  );
}

import { CreditCard } from 'lucide-react';
import Link from 'next/link';
import { adminNav } from '@/components/admin-nav';
import { AuthGuard } from '@/components/auth-guard';
import { NavLink } from '@/components/nav-link';
import { UserMenu } from '@/components/user-menu';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard roles={['admin', 'staff']}>
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
          <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
            <CreditCard className="h-5 w-5" /> Provisia
          </div>
          <nav className="flex-1 space-y-1 p-2">
            {adminNav.map(({ href, label, icon: Icon }) => (
              <NavLink
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
                activeClassName="bg-sidebar-accent font-medium"
              >
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t p-3 text-muted-foreground text-xs">
            <Link href="/portal" className="hover:underline">
              Client portal
            </Link>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
            <span className="font-semibold md:hidden">Provisia</span>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}

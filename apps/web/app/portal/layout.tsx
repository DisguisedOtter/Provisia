import { AuthGuard } from '@/components/auth-guard';
import { NavLink } from '@/components/nav-link';
import { portalNav } from '@/components/portal-nav';
import { UserMenu } from '@/components/user-menu';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard roles={['client', 'admin', 'staff']}>
      <div className="flex min-h-screen flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <span className="font-semibold">Provisia</span>
            <nav className="hidden items-center gap-1 md:flex">
              {portalNav.map(({ href, label }) => (
                <NavLink
                  key={href}
                  href={href}
                  className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
                  activeClassName="bg-accent text-foreground font-medium"
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </AuthGuard>
  );
}

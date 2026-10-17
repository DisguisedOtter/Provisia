'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function NavLink({
  href,
  children,
  className,
  activeClassName,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  activeClassName?: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href.split('/').length > 2 && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      className={cn(className, active && activeClassName)}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

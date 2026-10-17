import Link from 'next/link';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

export function AdminBreadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const all: Crumb[] = [{ label: 'Admin', href: '/admin' }, ...items];
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <Fragment key={`${c.href ?? ''}-${c.label}`}>
              <BreadcrumbItem>
                {last || !c.href ? (
                  <BreadcrumbPage className="max-w-[40vw] truncate">{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {last ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Page header with breadcrumbs, title, optional description/badges and an action slot. */
export function AdminPageHeader({
  title,
  description,
  crumbs,
  badges,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 space-y-3', className)}>
      {crumbs ? <AdminBreadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{title}</h1>
            {badges}
          </div>
          {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

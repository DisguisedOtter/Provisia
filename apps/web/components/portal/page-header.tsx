import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Page title block with optional back link and action slot. Mobile: actions wrap below the title. */
export function PageHeader({
  title,
  description,
  back,
  badge,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{title}</h1>
            {badge}
          </div>
          {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

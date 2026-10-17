'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isMissingEndpoint } from '@/lib/admin/form-errors';
import type { TableState } from '@/lib/admin/use-table-state';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { QueryState } from './query-state';

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Sort key sent to the API; omit for unsortable columns. */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  total?: number;
  rowKey: (row: T) => string;
  /** Row-level link: the first column becomes a stretched link covering the row. */
  rowHref?: (row: T) => string;
  state: TableState;
  onStateChange: (
    patch: Partial<Omit<TableState, 'filters'>> & { filters?: Record<string, string | undefined> },
  ) => void;
  isPending: boolean;
  error: unknown;
  refetch?: () => void;
  searchPlaceholder?: string;
  searchable?: boolean;
  filters?: FilterDef[];
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  dense?: boolean;
}

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export function DataTable<T>({
  columns,
  rows,
  total = 0,
  rowKey,
  rowHref,
  state,
  onStateChange,
  isPending,
  error,
  refetch,
  searchPlaceholder = 'Search…',
  searchable = true,
  filters = [],
  toolbar,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  dense,
}: DataTableProps<T>) {
  const [search, setSearch] = useState(state.search ?? '');
  useEffect(() => setSearch(state.search ?? ''), [state.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search || undefined) !== (state.search || undefined))
        onStateChange({ search: search || undefined });
    }, 350);
    return () => clearTimeout(t);
  }, [search, state.search, onStateChange]);

  const pages = Math.max(1, Math.ceil(total / state.perPage));
  const activeFilterCount = Object.keys(state.filters).length + (state.search ? 1 : 0);

  const toggleSort = (key: string) => {
    if (state.sort !== key) onStateChange({ sort: key, order: 'asc' });
    else if (state.order === 'asc') onStateChange({ sort: key, order: 'desc' });
    else onStateChange({ sort: undefined, order: undefined });
  };

  return (
    <div className="space-y-3">
      {(searchable || filters.length > 0 || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
                aria-label="Search"
              />
            </div>
          ) : null}
          {filters.map((f) => (
            <Select
              key={f.key}
              value={state.filters[f.key] ?? '__all'}
              onValueChange={(v) =>
                onStateChange({ filters: { [f.key]: v === '__all' ? undefined : v } })
              }
            >
              <SelectTrigger className="w-auto min-w-36" aria-label={f.label}>
                <SelectValue placeholder={f.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All {f.label.toLowerCase()}</SelectItem>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                onStateChange({
                  search: undefined,
                  filters: Object.fromEntries(filters.map((f) => [f.key, undefined])),
                });
              }}
            >
              <X /> Clear
            </Button>
          ) : null}
          {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.id}
                  className={cn(
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.hideBelow && HIDE[c.hideBelow],
                    c.headerClassName,
                  )}
                  aria-sort={
                    c.sortKey && state.sort === c.sortKey
                      ? state.order === 'desc'
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  {c.sortKey ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.sortKey as string)}
                      className={cn(
                        '-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent hover:text-accent-foreground',
                        c.align === 'right' && '-mr-2 ml-0 flex-row-reverse',
                      )}
                    >
                      {c.header}
                      {state.sort === c.sortKey ? (
                        state.order === 'desc' ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUp className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`s-${i.toString()}`}>
                    {columns.map((c) => (
                      <TableCell key={c.id} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}
            {!isPending && !error && rows && rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    title={activeFilterCount ? 'No results' : emptyTitle}
                    description={
                      activeFilterCount ? 'Try adjusting your search or filters.' : emptyDescription
                    }
                    action={activeFilterCount ? null : emptyAction}
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            ) : null}
            {!isPending && error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <QueryState isPending={false} error={error} refetch={refetch} compact>
                    {null}
                  </QueryState>
                </TableCell>
              </TableRow>
            ) : null}
            {!isPending &&
              rows?.map((row) => {
                const href = rowHref?.(row);
                return (
                  <TableRow key={rowKey(row)} className={cn(href && 'relative cursor-pointer')}>
                    {columns.map((c, i) => (
                      <TableCell
                        key={c.id}
                        className={cn(
                          dense && 'py-1.5',
                          c.align === 'right' && 'text-right',
                          c.align === 'center' && 'text-center',
                          c.hideBelow && HIDE[c.hideBelow],
                          c.className,
                        )}
                      >
                        {i === 0 && href ? (
                          <Link
                            href={href}
                            className="font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
                          >
                            {c.cell(row)}
                          </Link>
                        ) : (
                          <span
                            className={cn(
                              href && 'relative z-10 [&_a]:relative [&_button]:relative',
                            )}
                          >
                            {c.cell(row)}
                          </span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!isMissingEndpoint(error) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-sm">
          <div>
            {total > 0
              ? `${(state.page - 1) * state.perPage + 1}–${Math.min(state.page * state.perPage, total)} of ${total}`
              : '0 results'}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(state.perPage)}
              onValueChange={(v) => onStateChange({ perPage: Number(v) })}
            >
              <SelectTrigger size="sm" className="w-[4.5rem]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="tabular-nums">
              Page {state.page} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page <= 1}
              onClick={() => onStateChange({ page: state.page - 1 })}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page >= pages}
              onClick={() => onStateChange({ page: state.page + 1 })}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Simple static table for small embedded lists (no pagination/sorting). */
export function SimpleTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  dense?: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className="py-8" />;
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.id}
                className={cn(
                  c.align === 'right' && 'text-right',
                  c.hideBelow && HIDE[c.hideBelow],
                  c.headerClassName,
                )}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <TableRow key={rowKey(row)} className={cn(href && 'relative')}>
                {columns.map((c, i) => (
                  <TableCell
                    key={c.id}
                    className={cn(
                      dense && 'py-1.5',
                      c.align === 'right' && 'text-right',
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {i === 0 && href ? (
                      <Link
                        href={href}
                        className="font-medium after:absolute after:inset-0 hover:underline"
                      >
                        {c.cell(row)}
                      </Link>
                    ) : (
                      <span className={cn(href && 'relative z-10')}>{c.cell(row)}</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export interface TableState {
  page: number;
  perPage: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, string>;
}

/**
 * Table pagination / sort / filter state synced to the URL query string so lists are
 * shareable and survive refreshes. Changing a filter or search resets to page 1.
 */
export function useTableState(filterKeys: string[] = [], defaults: Partial<TableState> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const state = useMemo<TableState>(() => {
    const filters: Record<string, string> = {};
    for (const k of filterKeys) {
      const v = sp.get(k);
      if (v) filters[k] = v;
    }
    return {
      page: Number(sp.get('page') ?? 1) || 1,
      perPage: Number(sp.get('perPage') ?? defaults.perPage ?? 25) || 25,
      sort: sp.get('sort') ?? defaults.sort,
      order: (sp.get('order') as 'asc' | 'desc' | null) ?? defaults.order,
      search: sp.get('search') ?? undefined,
      filters,
    };
  }, [sp, filterKeys, defaults.perPage, defaults.sort, defaults.order]);

  const update = useCallback(
    (
      patch: Partial<Omit<TableState, 'filters'>> & {
        filters?: Record<string, string | undefined>;
      },
    ) => {
      const next = new URLSearchParams(sp.toString());
      const set = (k: string, v: string | number | undefined | null) => {
        if (v === undefined || v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      };
      if (patch.filters) for (const [k, v] of Object.entries(patch.filters)) set(k, v);
      if ('search' in patch) set('search', patch.search);
      if ('sort' in patch) set('sort', patch.sort);
      if ('order' in patch) set('order', patch.order);
      if ('perPage' in patch) set('perPage', patch.perPage);
      if ('page' in patch) set('page', patch.page === 1 ? undefined : patch.page);
      else if (patch.filters || 'search' in patch || 'perPage' in patch) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const query = useMemo<Record<string, string | number | undefined>>(
    () => ({
      page: state.page,
      perPage: state.perPage,
      sort: state.sort,
      order: state.order,
      search: state.search,
      ...state.filters,
    }),
    [state],
  );

  return { state, update, query };
}

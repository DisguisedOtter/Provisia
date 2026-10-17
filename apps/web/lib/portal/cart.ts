'use client';

import type { BillingCycle, CartItem, OrderItemType } from '@provisia/shared';
import { useSyncExternalStore } from 'react';

/** Cart line stored in localStorage; `CartItem` (the API shape) is derived from it. */
export interface CartLine {
  key: string;
  type: OrderItemType;
  productId?: string;
  productName?: string;
  groupSlug?: string;
  productSlug?: string;
  domainName?: string;
  billingCycle: BillingCycle;
  quantity: number;
  config: Record<string, unknown>;
  /** Price snapshot for display; the server recomputes at checkout. */
  setupFee: number;
  recurring: number;
  currency: string;
  /** Years for domain items. */
  years?: number;
}

export interface CartState {
  lines: CartLine[];
  promoCode: string;
  country: string;
  vatNumber: string;
}

const KEY = 'pv_cart';
const EMPTY: CartState = { lines: [], promoCode: '', country: 'NL', vatNumber: '' };
const listeners = new Set<() => void>();
let cache: CartState | null = null;

function read(): CartState {
  if (cache) return cache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<CartState>) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: CartState) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCart(): CartState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const cart = {
  add(line: Omit<CartLine, 'key'>): CartLine {
    const state = read();
    const key = `${line.type}:${line.productId ?? ''}:${line.domainName ?? ''}:${Date.now().toString(36)}`;
    const next = { ...line, key };
    // A domain can only be in the cart once.
    const lines =
      line.domainName && line.type !== 'product'
        ? state.lines.filter((l) => !(l.type === line.type && l.domainName === line.domainName))
        : state.lines;
    write({ ...state, lines: [...lines, next] });
    return next;
  },
  update(key: string, patch: Partial<CartLine>) {
    const state = read();
    write({ ...state, lines: state.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  },
  remove(key: string) {
    const state = read();
    write({ ...state, lines: state.lines.filter((l) => l.key !== key) });
  },
  setPromo(promoCode: string) {
    write({ ...read(), promoCode });
  },
  setTaxContext(country: string, vatNumber: string) {
    write({ ...read(), country, vatNumber });
  },
  clear() {
    write({ ...EMPTY, country: read().country });
  },
  hasDomain(domainName: string): boolean {
    return read().lines.some((l) => l.domainName === domainName && l.type !== 'product');
  },
};

export function toCartItems(lines: CartLine[]): CartItem[] {
  return lines.map((l) => ({
    type: l.type,
    productId: l.productId,
    domainName: l.domainName,
    billingCycle: l.billingCycle,
    quantity: l.quantity,
    config: l.years ? { ...l.config, years: l.years } : l.config,
  }));
}

/** Local, pre-tax estimate used until the server estimate arrives. */
export function cartTotals(lines: CartLine[]) {
  const currency = lines[0]?.currency ?? 'EUR';
  let dueToday = 0;
  for (const l of lines) dueToday += (l.recurring + l.setupFee) * l.quantity;
  return { currency, dueToday };
}

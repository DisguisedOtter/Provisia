'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { portalApi } from './api';
import { localeFromLanguage, useI18n } from './i18n';

export const portalKeys = {
  account: ['portal', 'account'] as const,
  contacts: ['portal', 'account', 'contacts'] as const,
  emails: (page: number) => ['portal', 'account', 'emails', page] as const,
  announcements: ['portal', 'announcements'] as const,
  services: (q: Record<string, unknown> = {}) => ['portal', 'services', q] as const,
  service: (id: string) => ['portal', 'services', id] as const,
  serviceUsage: (id: string, range: string) => ['portal', 'services', id, 'usage', range] as const,
  upgradeOptions: (id: string) => ['portal', 'services', id, 'upgrade-options'] as const,
  domains: (q: Record<string, unknown> = {}) => ['portal', 'domains', q] as const,
  domain: (id: string) => ['portal', 'domains', id] as const,
  invoices: (q: Record<string, unknown> = {}) => ['portal', 'invoices', q] as const,
  invoice: (id: string) => ['portal', 'invoices', id] as const,
  invoiceTxns: (id: string) => ['portal', 'invoices', id, 'transactions'] as const,
  gateways: ['portal', 'payments', 'gateways'] as const,
  methods: ['portal', 'payments', 'methods'] as const,
  autoPay: ['portal', 'payments', 'auto-pay'] as const,
  tickets: (q: Record<string, unknown> = {}) => ['portal', 'tickets', q] as const,
  ticket: (id: string) => ['portal', 'tickets', id] as const,
  departments: ['portal', 'tickets', 'departments'] as const,
  catalogGroups: ['public', 'catalog', 'groups'] as const,
  catalogProducts: (groupId?: string) =>
    ['public', 'catalog', 'products', groupId ?? 'all'] as const,
  catalogProduct: (slug: string) => ['public', 'catalog', 'product', slug] as const,
  tlds: ['public', 'domains', 'tlds'] as const,
  domainCheck: (domains: string[]) => ['public', 'domains', 'check', domains] as const,
};

/** Client profile of the logged-in client. Not fetched for staff (no clientId). */
export function useClientProfile() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: portalKeys.account,
    queryFn: async () => (await portalApi.account.get()).data,
    enabled: Boolean(me?.clientId),
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });
}

/** Switches the UI language to the client's profile language once it is known. */
export function useProfileLocaleSync() {
  const { data: client } = useClientProfile();
  const { setLocale } = useI18n();
  useEffect(() => {
    const l = localeFromLanguage(client?.language);
    if (l) setLocale(l, { persist: true });
  }, [client?.language, setLocale]);
}

export function useGateways() {
  return useQuery({
    queryKey: portalKeys.gateways,
    queryFn: async () => (await portalApi.payments.gateways()).data,
    staleTime: 5 * 60_000,
  });
}

export function usePaymentMethods(enabled = true) {
  return useQuery({
    queryKey: portalKeys.methods,
    queryFn: async () => (await portalApi.payments.methods()).data,
    enabled,
  });
}

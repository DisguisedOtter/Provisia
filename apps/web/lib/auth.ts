'use client';

import type { AuthUser } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, api } from './api';

export const ME_KEY = ['auth', 'me'] as const;
/** sessionStorage key holding the pending 2FA challenge between /login and /2fa. */
export const TWO_FACTOR_STORAGE_KEY = 'pv_2fa_challenge';

/** Current user; `null` when not authenticated. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        return (await api.auth.me(signal)).data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => {
      qc.setQueryData(ME_KEY, null);
      qc.clear();
      router.push('/login');
    },
  });
}

/** Where a user lands after login: `next` when safe, otherwise their home; staff needing 2FA go to enrolment. */
export function postLoginPath(user: AuthUser, next: string | null): string {
  if (user.totpEnrollmentRequired) return '/portal/account/security?enroll=1';
  const safe = safeLocalPath(next);
  if (safe) return safe;
  return user.role === 'client' ? '/portal' : '/admin';
}

/**
 * Accepts only same-origin paths. Rejects `//host`, `/\host` (browsers treat the backslash as a
 * slash), scheme-relative tricks and anything the URL parser resolves to another origin.
 */
export function safeLocalPath(next: string | null | undefined): string | null {
  if (!next?.startsWith('/') || /^\/[/\\]/.test(next) || /[\0\r\n]/.test(next)) return null;
  try {
    const base = 'https://provisia.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** `true` when the user (or the admin behind an impersonation) may do `permission`. */
export function useCan(permission: string): boolean {
  const { data: me } = useMe();
  if (!me || me.role === 'client') return false;
  if (me.permissions.includes('*')) return true;
  const [area, action] = permission.split('.');
  return me.permissions.some(
    (p) =>
      p === permission ||
      p === `${area}.*` ||
      (action === 'read' && (p === `${area}.write` || p === `${area}.manage`)),
  );
}

export function useStopImpersonation() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.auth.stopImpersonation(),
    onSuccess: ({ data }) => {
      qc.clear();
      qc.setQueryData(ME_KEY, data);
      router.push('/admin/clients');
    },
    onError: () => {
      qc.clear();
      router.push('/login');
    },
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public', 'settings'],
    queryFn: ({ signal }) => api.publicSettings(signal).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

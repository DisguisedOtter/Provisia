'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { AuthCard, AuthLink } from '@/components/auth-card';
import { ApiError, api } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const verify = useMutation({ mutationFn: (t: string) => api.auth.verifyEmail(t) });
  // biome-ignore lint/correctness/useExhaustiveDependencies: verify once per token; the mutation object changes every render
  useEffect(() => {
    if (token) verify.mutate(token);
  }, [token]);

  if (!token || verify.isError) {
    return (
      <p className="text-sm">
        {verify.error instanceof ApiError
          ? verify.error.message
          : 'This verification link is invalid.'}{' '}
        <AuthLink href="/login">Sign in</AuthLink> to request a new one.
      </p>
    );
  }
  if (verify.isSuccess) {
    return (
      <p className="text-sm">
        Your email address is verified. <AuthLink href="/login">Sign in</AuthLink> to continue.
      </p>
    );
  }
  return <p className="text-muted-foreground text-sm">Verifying…</p>;
}

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Email verification">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthCard>
  );
}

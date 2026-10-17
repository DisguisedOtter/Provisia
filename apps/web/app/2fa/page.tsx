'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthCard, AuthLink } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import { ME_KEY, postLoginPath, TWO_FACTOR_STORAGE_KEY } from '@/lib/auth';

function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TWO_FACTOR_STORAGE_KEY);
      const parsed = raw
        ? (JSON.parse(raw) as { challengeToken: string; expiresAt: string })
        : null;
      if (!parsed || new Date(parsed.expiresAt).getTime() < Date.now()) {
        router.replace('/login');
        return;
      }
      setChallengeToken(parsed.challengeToken);
    } catch {
      router.replace('/login');
    }
  }, [router]);

  const verify = useMutation({
    mutationFn: () =>
      api.auth.login2fa({ challengeToken: challengeToken ?? '', code: code.trim() }),
    onSuccess: ({ data }) => {
      try {
        sessionStorage.removeItem(TWO_FACTOR_STORAGE_KEY);
      } catch {}
      qc.setQueryData(ME_KEY, data);
      router.replace(postLoginPath(data, params.get('next')));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'invalid_token') {
        toast.error('Your login expired, please sign in again');
        router.replace('/login');
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Verification failed');
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="code">{useBackup ? 'Backup code' : 'Authenticator code'}</Label>
        <Input
          id="code"
          autoFocus
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={useBackup ? 'XXXXX-XXXXX' : '123456'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={verify.isPending || code.length < 6}>
        {verify.isPending ? 'Verifying…' : 'Verify'}
      </Button>
      <button
        type="button"
        className="w-full text-center text-muted-foreground text-sm underline-offset-4 hover:underline"
        onClick={() => setUseBackup((v) => !v)}
      >
        {useBackup ? 'Use your authenticator app instead' : 'Use a backup code instead'}
      </button>
    </form>
  );
}

export default function TwoFactorPage() {
  return (
    <AuthCard
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <Suspense>
        <TwoFactorForm />
      </Suspense>
    </AuthCard>
  );
}

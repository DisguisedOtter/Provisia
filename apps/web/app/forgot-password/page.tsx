'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthCard, AuthLink } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: (e: string) => api.auth.forgotPassword(e) });

  return (
    <AuthCard
      title="Reset your password"
      description="We will email you a link that is valid for a limited time."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      {send.isSuccess ? (
        <p className="text-sm">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your
          spam folder too.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(email);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {send.isError ? (
            <p className="text-destructive text-sm">Too many requests, please try again later.</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

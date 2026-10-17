'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginRequest, loginRequestSchema } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { ME_KEY, postLoginPath, TWO_FACTOR_STORAGE_KEY, usePublicSettings } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginRequestSchema>, unknown, LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const login = useMutation({
    mutationFn: (values: LoginRequest) => api.auth.login(values),
    onSuccess: (res) => {
      const next = params.get('next');
      if (!res.data && res.twoFactor) {
        try {
          sessionStorage.setItem(TWO_FACTOR_STORAGE_KEY, JSON.stringify(res.twoFactor));
        } catch {
          /* private mode: the 2fa page asks to sign in again */
        }
        router.replace(`/2fa${next ? `?next=${encodeURIComponent(next)}` : ''}`);
        return;
      }
      if (res.data) {
        qc.setQueryData(ME_KEY, res.data);
        router.replace(postLoginPath(res.data, next));
      }
    },
    onError: (err, values) => {
      if (err instanceof ApiError && err.code === 'email_not_verified') {
        setUnverifiedEmail(values.email);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Login failed');
    },
  });

  const resend = useMutation({
    mutationFn: (email: string) => api.auth.resendVerification(email),
    onSuccess: () => toast.success('Verification email sent'),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-4">
        {unverifiedEmail ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
            Please verify your email address first.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => resend.mutate(unverifiedEmail)}
              disabled={resend.isPending}
            >
              Resend the email
            </button>
          </div>
        ) : null}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <AuthLink href="/forgot-password">Forgot password?</AuthLink>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="rememberMe"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              </FormControl>
              <FormLabel className="font-normal">Keep me signed in for 30 days</FormLabel>
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Form>
  );
}

export default function LoginPage() {
  const { data: settings } = usePublicSettings();
  return (
    <AuthCard
      title={`Sign in to ${settings?.companyName ?? 'Provisia'}`}
      description="Use your staff or client account."
      footer={
        settings?.allowRegistration !== false ? (
          <>
            No account yet? <AuthLink href="/register">Create one</AuthLink>
          </>
        ) : undefined
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}

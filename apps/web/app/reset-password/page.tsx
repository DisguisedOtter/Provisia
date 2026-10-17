'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
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
import { ME_KEY, postLoginPath } from '@/lib/auth';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const token = params.get('token') ?? '';
  const isInvite = params.get('invite') === '1';
  const check = useQuery({
    queryKey: ['auth', 'reset-token', token, isInvite],
    queryFn: () =>
      api.auth.checkResetToken(token, isInvite ? 'invite' : 'reset').then((r) => r.data),
    enabled: token.length > 0,
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = useMutation({
    mutationFn: async (v: FormValues) => {
      if (isInvite) {
        const res = await api.auth.acceptInvite({ token, password: v.password });
        return res.data;
      }
      await api.auth.resetPassword({ token, password: v.password });
      return null;
    },
    onSuccess: (user) => {
      if (user) {
        qc.setQueryData(ME_KEY, user);
        toast.success('Welcome aboard');
        router.replace(postLoginPath(user, null));
      } else {
        toast.success('Password updated, please sign in');
        router.replace('/login');
      }
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not set the password'),
  });

  if (!token || (check.data && !check.data.valid)) {
    return (
      <p className="text-sm">
        This link is invalid or has expired.{' '}
        <AuthLink href="/forgot-password">Request a new one</AuthLink>.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4">
        {check.data?.email ? (
          <p className="text-muted-foreground text-sm">
            Account: <strong>{check.data.email}</strong>
          </p>
        ) : null}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repeat password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submit.isPending || check.isPending}>
          {submit.isPending
            ? 'Saving…'
            : isInvite
              ? 'Set password and sign in'
              : 'Set new password'}
        </Button>
      </form>
    </Form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Choose a new password"
      description="At least 10 characters with letters and a number. Other sessions will be signed out."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterRequest, registerRequestSchema } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { ME_KEY, usePublicSettings } from '@/lib/auth';

const EU = [
  'NL',
  'BE',
  'DE',
  'FR',
  'AT',
  'ES',
  'IT',
  'PT',
  'IE',
  'LU',
  'DK',
  'SE',
  'FI',
  'PL',
  'CZ',
];

type Field = {
  name: keyof z.input<typeof registerRequestSchema>;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  optional?: boolean;
};

const FIELDS: Field[][] = [
  [
    { name: 'firstName', label: 'First name', autoComplete: 'given-name' },
    { name: 'lastName', label: 'Last name', autoComplete: 'family-name' },
  ],
  [{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }],
  [{ name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' }],
  [
    { name: 'companyName', label: 'Company', autoComplete: 'organization', optional: true },
    { name: 'vatNumber', label: 'VAT number', placeholder: 'NL123456789B01', optional: true },
  ],
  [{ name: 'address1', label: 'Address', autoComplete: 'address-line1' }],
  [
    { name: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
    { name: 'city', label: 'City', autoComplete: 'address-level2' },
  ],
  [
    { name: 'country', label: 'Country (ISO code)', autoComplete: 'country', placeholder: 'NL' },
    { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', optional: true },
  ],
];

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const [done, setDone] = useState<string | null>(null);
  const form = useForm<z.input<typeof registerRequestSchema>, unknown, RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      companyName: '',
      vatNumber: '',
      address1: '',
      city: '',
      postalCode: '',
      country: 'NL',
      phone: '',
      language: 'en',
    },
  });

  const register = useMutation({
    mutationFn: (values: RegisterRequest) =>
      api.auth.register({
        ...values,
        companyName: values.companyName || null,
        vatNumber: values.vatNumber || null,
        phone: values.phone || null,
        country: values.country.toUpperCase(),
      }),
    onSuccess: ({ data, verificationRequired }) => {
      if (verificationRequired) {
        setDone(data.email);
        return;
      }
      qc.setQueryData(ME_KEY, data);
      router.replace('/portal');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Registration failed'),
  });

  if (settings && !settings.allowRegistration) {
    return (
      <AuthCard
        title="Registration closed"
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <p className="text-sm">New accounts are created by our staff. Please contact support.</p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="Check your inbox"
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <p className="text-sm">
          We sent a verification link to <strong>{done}</strong>. Open it to activate your account.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="EU addresses: enter your VAT number for reverse-charge invoicing."
      footer={
        <>
          Already registered? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => register.mutate(v))} className="space-y-3">
          {FIELDS.map((row) => (
            <div
              key={row.map((f) => f.name).join('-')}
              className={row.length > 1 ? 'grid grid-cols-2 gap-3' : ''}
            >
              {row.map((f) => (
                <FormField
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {f.label}
                        {f.optional ? (
                          <span className="text-muted-foreground"> (optional)</span>
                        ) : null}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type={f.type ?? 'text'}
                          autoComplete={f.autoComplete}
                          placeholder={f.placeholder}
                          list={f.name === 'country' ? 'eu-countries' : undefined}
                          {...field}
                          value={typeof field.value === 'string' ? field.value : ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          ))}
          <datalist id="eu-countries">
            {EU.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <FormField
            control={form.control}
            name="acceptTerms"
            render={({ field }) => (
              <FormItem className="flex items-start gap-2 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(v) => field.onChange(v === true ? true : undefined)}
                  />
                </FormControl>
                <div>
                  <FormLabel className="font-normal">
                    I accept the terms of service and privacy policy
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}

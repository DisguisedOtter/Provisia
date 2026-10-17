'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginRequest, loginRequestSchema, registerRequestSchema } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';
import { ME_KEY, useLogout, useMe } from '@/lib/auth';
import { portalApi, publicApi } from '@/lib/portal/api';
import { cart, toCartItems, useCart } from '@/lib/portal/cart';
import { useI18n } from '@/lib/portal/i18n';
import { EmptyState } from '../../empty-state';
import { PageHeader } from '../../page-header';
import { CartSummary } from './cart';
import { OrderSteps } from './steps';

const loginSchema = loginRequestSchema.pick({ email: true, password: true });
type LoginValues = z.infer<typeof loginSchema>;

function LoginInline() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (v: LoginValues) => api.auth.login(v as LoginRequest),
    onSuccess: ({ data }) => qc.setQueryData(ME_KEY, data),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('checkout.loginFailed')),
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-3">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('common.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
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
              <FormLabel>{t('common.password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? t('common.loading') : t('checkout.login')}
        </Button>
      </form>
    </Form>
  );
}

const registerSchema = registerRequestSchema.omit({ acceptTerms: true, language: true }).extend({
  acceptTerms: z.boolean(),
  companyName: z.string().max(200),
  vatNumber: z.string().max(32),
  address2: z.string().max(200),
  state: z.string().max(100),
  phone: z.string().max(40),
});
type RegisterValues = z.infer<typeof registerSchema>;

function RegisterInline({ country, vatNumber }: { country: string; vatNumber: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      companyName: '',
      vatNumber,
      address1: '',
      address2: '',
      city: '',
      postalCode: '',
      state: '',
      country,
      phone: '',
      acceptTerms: false,
    },
  });
  const register = useMutation({
    mutationFn: (v: RegisterValues) => {
      if (!v.acceptTerms) throw new ApiError(400, 'validation_error', t('val.terms'));
      return publicApi.auth.register({
        ...v,
        acceptTerms: true,
        language: locale,
        companyName: v.companyName || null,
        vatNumber: v.vatNumber || null,
        address2: v.address2 || null,
        state: v.state || null,
        phone: v.phone || null,
      });
    },
    onSuccess: ({ data }) => qc.setQueryData(ME_KEY, data),
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? e.status === 409
            ? t('checkout.emailTaken')
            : e.message
          : t('checkout.registerFailed'),
      ),
  });
  const f = (
    name: keyof RegisterValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...props} {...field} value={String(field.value ?? '')} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => register.mutate(v))} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {f('firstName', t('account.firstName'), { autoComplete: 'given-name' })}
          {f('lastName', t('account.lastName'), { autoComplete: 'family-name' })}
          {f('email', t('common.email'), { type: 'email', autoComplete: 'email' })}
          {f('password', t('common.password'), { type: 'password', autoComplete: 'new-password' })}
          {f('companyName', `${t('account.companyName')} (${t('common.optional')})`, {
            autoComplete: 'organization',
          })}
          {f('vatNumber', `${t('account.vatNumber')} (${t('common.optional')})`, {
            className: 'uppercase',
          })}
          <div className="sm:col-span-2">
            {f('address1', t('domains.address1'), { autoComplete: 'address-line1' })}
          </div>
          {f('postalCode', t('domains.postalCode'), { autoComplete: 'postal-code' })}
          {f('city', t('domains.city'), { autoComplete: 'address-level2' })}
          {f('country', t('domains.country'), {
            maxLength: 2,
            className: 'uppercase',
            autoComplete: 'country',
          })}
          {f('phone', `${t('common.phone')} (${t('common.optional')})`, {
            type: 'tel',
            autoComplete: 'tel',
          })}
        </div>
        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(Boolean(v))}
                  className="mt-0.5"
                />{' '}
                {t('checkout.terms')}
              </label>
              {!field.value && form.formState.isSubmitted ? (
                <p className="text-destructive text-xs">{t('val.terms')}</p>
              ) : null}
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? t('common.loading') : t('checkout.register')}
        </Button>
      </form>
    </Form>
  );
}

export function CheckoutView() {
  const { t } = useI18n();
  const router = useRouter();
  const state = useCart();
  const { data: me, isPending } = useMe();
  const logout = useLogout();
  const [notes, setNotes] = useState('');
  const place = useMutation({
    mutationFn: () =>
      portalApi.orders.create({
        items: toCartItems(state.lines),
        promoCode: state.promoCode || undefined,
        notes: notes || undefined,
      }),
    onSuccess: ({ data }) => {
      cart.clear();
      router.push(
        `/checkout/complete?order=${data.id}&number=${encodeURIComponent(data.number)}${data.invoiceId ? `&invoice=${data.invoiceId}` : ''}`,
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  if (state.lines.length === 0 && !place.isPending && !place.isSuccess) {
    return (
      <div>
        <OrderSteps current={3} />
        <EmptyState
          icon={ShoppingCart}
          title={t('cart.empty')}
          description={t('cart.emptyHint')}
          action={
            <Button asChild>
              <Link href="/order">{t('cart.browse')}</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const isClient = me?.role === 'client';
  return (
    <div>
      <OrderSteps current={3} />
      <PageHeader title={t('checkout.title')} back={{ href: '/cart', label: t('cart.title') }} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('checkout.account')}</CardTitle>
              {!me && !isPending ? (
                <CardDescription>
                  {t('checkout.haveAccount')} / {t('checkout.newHere')}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              {isPending ? null : me ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{t('checkout.loggedInAs', { email: me.email })}</span>
                  <Button variant="link" size="sm" className="px-0" onClick={() => logout.mutate()}>
                    {t('checkout.notYou')}
                  </Button>
                  {!isClient ? (
                    <Alert className="w-full">
                      <AlertDescription>{t('checkout.staffWarning')}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : (
                <Tabs defaultValue="register">
                  <TabsList className="mb-4 w-full">
                    <TabsTrigger value="register" className="flex-1">
                      {t('checkout.createAccount')}
                    </TabsTrigger>
                    <TabsTrigger value="login" className="flex-1">
                      {t('checkout.login')}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="register">
                    <RegisterInline country={state.country} vatNumber={state.vatNumber} />
                  </TabsContent>
                  <TabsContent value="login">
                    <LoginInline />
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('checkout.notes')}</CardTitle>
              <CardDescription>{t('checkout.notesHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </CardContent>
          </Card>
        </div>
        <div>
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="text-base">{t('order.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CartSummary
                country={state.country}
                vatNumber={state.vatNumber}
                promoCode={state.promoCode}
              />
              <Button
                className="w-full"
                size="lg"
                disabled={!isClient || place.isPending}
                onClick={() => place.mutate()}
              >
                {place.isPending ? t('checkout.placing') : t('checkout.place')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function CheckoutCompleteView({
  orderNumber,
  invoiceId,
}: {
  orderNumber: string;
  invoiceId: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md py-10">
      <OrderSteps current={3} />
      <Card>
        <CardContent className="flex flex-col items-center p-8 text-center">
          <ShoppingCart className="mb-4 size-10 text-emerald-600 dark:text-emerald-400" />
          <h1 className="font-semibold text-xl">{t('checkout.placed', { number: orderNumber })}</h1>
          <p className="mt-2 text-muted-foreground text-sm">{t('checkout.placedHint')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {invoiceId ? (
              <Button asChild>
                <Link href={`/portal/invoices/${invoiceId}?pay=1`}>{t('checkout.payInvoice')}</Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/portal">{t('checkout.viewOrder')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

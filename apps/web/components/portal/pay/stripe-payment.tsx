'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/portal/i18n';

const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(key: string) {
  let p = stripeCache.get(key);
  if (!p) {
    p = loadStripe(key);
    stripeCache.set(key, p);
  }
  return p;
}

function StripeForm({
  amountLabel,
  returnUrl,
  onDone,
  mode,
}: {
  amountLabel: string;
  returnUrl: string;
  onDone?: () => void;
  mode: 'payment' | 'setup';
}) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        const { error } =
          mode === 'setup'
            ? await stripe.confirmSetup({ elements, confirmParams: { return_url: returnUrl } })
            : await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
        setBusy(false);
        if (error) toast.error(error.message ?? t('pay.return.failed'));
        else onDone?.();
      }}
      className="space-y-4"
    >
      <PaymentElement options={{ layout: 'tabs' }} />
      <Button type="submit" className="w-full" disabled={!stripe || busy}>
        {busy ? t('pay.processing') : amountLabel}
      </Button>
    </form>
  );
}

/**
 * Embedded Stripe Elements for a `clientSecret` returned by `POST /portal/invoices/:id/pay`
 * (PaymentIntent) or `POST /portal/payments/methods` (SetupIntent, `mode="setup"`).
 * The publishable key comes from `publicConfig.publishableKey` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
 */
export function StripePayment({
  clientSecret,
  publishableKey,
  amountLabel,
  returnUrl,
  onDone,
  mode = 'payment',
}: {
  clientSecret: string;
  publishableKey?: string | null;
  amountLabel: string;
  returnUrl: string;
  onDone?: () => void;
  mode?: 'payment' | 'setup';
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const key = publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const stripePromise = useMemo(() => (key ? getStripe(key) : null), [key]);
  if (!stripePromise)
    return <p className="text-destructive text-sm">{t('pay.stripeNotConfigured')}</p>;
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: resolvedTheme === 'dark' ? 'night' : 'stripe' },
      }}
    >
      <StripeForm amountLabel={amountLabel} returnUrl={returnUrl} onDone={onDone} mode={mode} />
    </Elements>
  );
}

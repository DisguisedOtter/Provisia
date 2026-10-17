'use client';

import type { InvoiceWithItems, PaymentStart } from '@provisia/shared';
import { useMutation } from '@tanstack/react-query';
import { Bitcoin, Building2, CreditCard, Landmark, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import type { DictKey } from '@/lib/portal/dictionary';
import { useGateways, usePaymentMethods } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { ErrorState } from '../error-boundary';
import { useMoney } from '../money';
import { StripePayment } from './stripe-payment';

const ICONS: Record<string, typeof CreditCard> = {
  stripe: CreditCard,
  mollie: Landmark,
  paypal: Wallet,
  btcpay: Bitcoin,
  banktransfer: Building2,
};

export function returnUrlFor(invoiceId: string, gateway: string) {
  return `${window.location.origin}/portal/invoices/${invoiceId}/payment/return?gateway=${encodeURIComponent(gateway)}`;
}

/** Gateway picker → redirect (Mollie/PayPal/BTCPay) or embedded Stripe Elements when a clientSecret is returned. */
export function PayDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceWithItems;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const fmt = useMoney();
  const gateways = useGateways();
  const methods = usePaymentMethods(open);
  const [choice, setChoice] = useState<string>('');
  const [save, setSave] = useState(false);
  const [started, setStarted] = useState<PaymentStart | null>(null);
  const due = invoice.total - invoice.creditApplied;
  const amountLabel = t('pay.payNow', { amount: fmt(due, invoice.currency) });

  const pay = useMutation({
    mutationFn: () => {
      const [kind, id] = choice.split(':') as ['gw' | 'pm', string];
      const gateway = kind === 'pm' ? (methods.data?.find((m) => m.id === id)?.gateway ?? '') : id;
      return portalApi.invoices.pay(invoice.id, {
        gateway,
        paymentMethodId: kind === 'pm' ? id : undefined,
        saveMethod: kind === 'gw' ? save : undefined,
        returnUrl: returnUrlFor(invoice.id, gateway),
      });
    },
    onSuccess: ({ data }) => {
      if (data.redirectUrl) {
        window.location.assign(data.redirectUrl);
        return;
      }
      if (data.clientSecret) {
        setStarted(data);
        return;
      }
      // Charged a saved method / credit: the return page polls the invoice status.
      window.location.assign(
        `${returnUrlFor(invoice.id, data.gateway)}&txn=${encodeURIComponent(data.txnId)}`,
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  const selectedGateway = choice.startsWith('gw:')
    ? gateways.data?.find((g) => g.id === choice.slice(3))
    : undefined;
  const activeMethods = (methods.data ?? []).filter((m) => m.status === 'active');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setStarted(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pay.title', { number: invoice.number ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('common.total')}: {fmt(due, invoice.currency)}
          </DialogDescription>
        </DialogHeader>
        {started?.clientSecret ? (
          <StripePayment
            clientSecret={started.clientSecret}
            publishableKey={(started.publicConfig?.publishableKey as string | undefined) ?? null}
            amountLabel={amountLabel}
            returnUrl={returnUrlFor(invoice.id, started.gateway)}
          />
        ) : gateways.isPending ? (
          <Skeleton className="h-32" />
        ) : gateways.isError ? (
          <ErrorState error={gateways.error} compact />
        ) : gateways.data.length === 0 && activeMethods.length === 0 ? (
          <div className="text-sm">
            <p className="font-medium">{t('pay.noGateways')}</p>
            <p className="text-muted-foreground">{t('pay.noGatewaysHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup value={choice} onValueChange={setChoice} className="gap-2">
              {activeMethods.length > 0 ? (
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('pay.savedMethods')}
                </p>
              ) : null}
              {activeMethods.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
                >
                  <RadioGroupItem value={`pm:${m.id}`} />
                  <CreditCard className="size-4 text-muted-foreground" />
                  <span className="flex-1 text-sm">{m.label}</span>
                  {m.isDefault ? (
                    <span className="text-muted-foreground text-xs">{t('methods.default')}</span>
                  ) : null}
                </label>
              ))}
              {activeMethods.length > 0 && gateways.data.length > 0 ? (
                <p className="pt-2 text-muted-foreground text-xs uppercase tracking-wide">
                  {t('pay.newMethod')}
                </p>
              ) : null}
              {gateways.data.map((g) => {
                const Icon = ICONS[g.id] ?? CreditCard;
                const key = `pay.gateway.${g.id}` as DictKey;
                const hint = t(key);
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
                  >
                    <RadioGroupItem value={`gw:${g.id}`} />
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="block text-sm">{g.name}</span>
                      {hint !== key ? (
                        <span className="block text-muted-foreground text-xs">{hint}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
            {selectedGateway?.capabilities.savedMethods ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={save} onCheckedChange={(v) => setSave(Boolean(v))} />{' '}
                {t('pay.saveMethod')}
              </label>
            ) : null}
            <Button
              className="w-full"
              disabled={!choice || pay.isPending}
              onClick={() => pay.mutate()}
            >
              {pay.isPending ? t('pay.processing') : amountLabel}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

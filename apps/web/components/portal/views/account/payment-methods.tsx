'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { fmtDate } from '@/lib/portal/format';
import { portalKeys, useGateways, usePaymentMethods } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import type { PaymentMethod } from '@/lib/portal/types';
import { ConfirmDialog } from '../../confirm-dialog';
import { EmptyState } from '../../empty-state';
import { ErrorState } from '../../error-boundary';
import { StripePayment } from '../../pay/stripe-payment';
import { QueryState } from '../../query-state';
import { ListSkeleton } from '../../skeletons';
import { StatusBadge } from '../../status-badge';

function AddMethodDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const gateways = useGateways();
  const [setup, setSetup] = useState<{
    clientSecret: string;
    publishableKey?: string | null;
  } | null>(null);
  const returnUrl = () => `${window.location.origin}/portal/account/payment-methods?setup=done`;
  const start = useMutation({
    mutationFn: (gateway: string) =>
      portalApi.payments.addMethod({ gateway, returnUrl: returnUrl() }),
    onSuccess: ({ data }) => {
      if (data.redirectUrl) window.location.assign(data.redirectUrl);
      else if (data.clientSecret)
        setSetup({
          clientSecret: data.clientSecret,
          publishableKey: data.publicConfig?.publishableKey as string | undefined,
        });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const savable = (gateways.data ?? []).filter((g) => g.capabilities.savedMethods);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSetup(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('methods.add')}</DialogTitle>
          <DialogDescription>{t('methods.addHint')}</DialogDescription>
        </DialogHeader>
        {setup ? (
          <StripePayment
            mode="setup"
            clientSecret={setup.clientSecret}
            publishableKey={setup.publishableKey}
            amountLabel={t('common.save')}
            returnUrl={returnUrl()}
          />
        ) : gateways.isError ? (
          <ErrorState error={gateways.error} compact />
        ) : savable.length === 0 && !gateways.isPending ? (
          <p className="text-muted-foreground text-sm">{t('pay.noGateways')}</p>
        ) : (
          <div className="grid gap-2">
            {savable.map((g) => (
              <Button
                key={g.id}
                variant="outline"
                className="justify-start"
                disabled={start.isPending}
                onClick={() => start.mutate(g.id)}
              >
                <CreditCard className="size-4" /> {g.name}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PaymentMethodsView() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const methods = usePaymentMethods();
  const autoPay = useQuery({
    queryKey: portalKeys.autoPay,
    queryFn: async () => (await portalApi.payments.autoPay()).data,
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong'));
  const setDefault = useMutation({
    mutationFn: (id: string) => portalApi.payments.setDefault(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.methods }),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => portalApi.payments.removeMethod(id),
    onSuccess: () => {
      toast.success(t('methods.removed'));
      qc.invalidateQueries({ queryKey: portalKeys.methods });
      setRemoving(null);
    },
    onError: onErr,
  });
  const toggleAutoPay = useMutation({
    mutationFn: (enabled: boolean) => portalApi.payments.setAutoPay({ enabled }),
    onSuccess: ({ data }) => {
      qc.setQueryData(portalKeys.autoPay, data);
      toast.success(t('methods.autoPayUpdated'));
    },
    onError: onErr,
  });
  const hasActive = (methods.data ?? []).some((m) => m.status === 'active');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('methods.autoPay')}</CardTitle>
          <CardDescription>{t('methods.autoPayHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="auto-pay" className="text-sm">
            {hasActive ? t('methods.autoPay') : t('methods.autoPayNeedsMethod')}
          </Label>
          <Switch
            id="auto-pay"
            checked={autoPay.data?.enabled ?? false}
            disabled={!hasActive || autoPay.isError || toggleAutoPay.isPending}
            onCheckedChange={(v) => toggleAutoPay.mutate(v)}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{t('methods.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('methods.description')}</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> {t('methods.add')}
        </Button>
      </div>
      <QueryState
        query={methods}
        skeleton={<ListSkeleton rows={2} />}
        empty={
          <EmptyState
            icon={CreditCard}
            title={t('methods.empty')}
            description={t('methods.emptyHint')}
          />
        }
      >
        {(list) => (
          <Card className="divide-y p-0">
            {list.map((m) => (
              <div key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <CreditCard className="hidden size-5 text-muted-foreground sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {m.label}{' '}
                    {m.isDefault ? (
                      <span className="rounded bg-muted px-1.5 text-[10px] uppercase">
                        {t('methods.default')}
                      </span>
                    ) : null}{' '}
                    {m.status !== 'active' ? <StatusBadge status={m.status} /> : null}
                  </div>
                  <div className="text-muted-foreground text-xs capitalize">
                    {m.gateway} · {m.type}
                    {m.expiresAt ? ` · ${fmtDate(m.expiresAt, locale)}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!m.isDefault && m.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate(m.id)}
                    >
                      {t('methods.makeDefault')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(m)}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </QueryState>
      <AddMethodDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('methods.removeConfirm')}
        destructive
        confirmLabel={t('common.remove')}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

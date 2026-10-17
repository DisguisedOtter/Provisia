'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { BillingCycle, ProductPrice } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  ExternalLink,
  KeyRound,
  Power,
  PowerOff,
  RotateCw,
  Square,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import type { DictKey } from '@/lib/portal/dictionary';
import { fmtBytesFromMb, fmtDate, fmtPercent } from '@/lib/portal/format';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import {
  type CancellationType,
  normalizeUsage,
  type PowerAction,
  type ServiceDetail,
} from '@/lib/portal/types';
import { ErrorState } from '../error-boundary';
import { KeyValue } from '../key-value';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { DetailSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';
import { UsageChart, UsageMeter } from '../usage-chart';

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function isVps(s: ServiceDetail) {
  return (
    s.product?.type === 'vps' || s.product?.module === 'proxmox' || s.capabilities?.power === true
  );
}

/* ---------- Reset password ---------- */
function ResetPasswordDialog({
  service,
  open,
  onOpenChange,
}: {
  service: ServiceDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const schema = z
    .object({
      password: z.string().min(8, t('val.min8')).max(200),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ['confirm'],
      message: t('val.passwordsMatch'),
    });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      portalApi.services.changePassword(service.id, v.password),
    onSuccess: () => {
      toast.success(t('services.passwordChanged'));
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('services.resetPassword')}</DialogTitle>
          <DialogDescription>{t('services.resetPasswordHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('services.newPassword')}</FormLabel>
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
                  <FormLabel>{t('common.confirm')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Upgrade / downgrade ---------- */
function UpgradeDialog({
  service,
  open,
  onOpenChange,
}: {
  service: ServiceDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [productId, setProductId] = useState<string>('');
  const [cycle, setCycle] = useState<BillingCycle>(service.billingCycle);
  const options = useQuery({
    queryKey: portalKeys.upgradeOptions(service.id),
    queryFn: async () => (await portalApi.services.upgradeOptions(service.id)).data,
    enabled: open,
  });
  const selected = options.data?.find((o) => o.product.id === productId);
  const cycles: ProductPrice[] = selected?.prices ?? [];
  const preview = useQuery({
    queryKey: ['portal', 'services', service.id, 'upgrade-preview', productId, cycle],
    queryFn: async () =>
      (await portalApi.services.upgradePreview(service.id, { productId, billingCycle: cycle }))
        .data,
    enabled: open && Boolean(productId) && cycles.some((p) => p.billingCycle === cycle),
  });
  const confirm = useMutation({
    mutationFn: () => portalApi.services.upgrade(service.id, { productId, billingCycle: cycle }),
    onSuccess: ({ data }) => {
      toast.success(t('services.upgradeOrdered'));
      qc.invalidateQueries({ queryKey: portalKeys.service(service.id) });
      onOpenChange(false);
      if (data.invoiceId) window.location.assign(`/portal/invoices/${data.invoiceId}?pay=1`);
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('services.upgrade')}</DialogTitle>
          <DialogDescription>{t('services.upgradeHint')}</DialogDescription>
        </DialogHeader>
        {options.isPending ? (
          <Skeleton className="h-24" />
        ) : options.isError ? (
          <ErrorState error={options.error} compact />
        ) : options.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('services.noUpgradeOptions')}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('services.choosePackage')}</Label>
              <RadioGroup
                value={productId}
                onValueChange={(v) => {
                  setProductId(v);
                  const o = options.data.find((x) => x.product.id === v);
                  if (o && !o.prices.some((p) => p.billingCycle === cycle))
                    setCycle(o.prices[0]?.billingCycle ?? cycle);
                }}
                className="gap-2"
              >
                {options.data.map((o) => (
                  <label
                    key={o.product.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
                  >
                    <RadioGroupItem value={o.product.id} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{o.product.name}</div>
                      {o.product.description ? (
                        <div className="line-clamp-2 text-muted-foreground text-xs">
                          {o.product.description}
                        </div>
                      ) : null}
                    </div>
                    {o.prices[0] ? (
                      <div className="text-right text-sm tabular-nums">
                        <Money amount={o.prices[0].recurring} currency={o.prices[0].currency} />
                        <span className="text-muted-foreground text-xs">
                          {' '}
                          / {t(`cycle.short.${o.prices[0].billingCycle}` as DictKey)}
                        </span>
                      </div>
                    ) : null}
                  </label>
                ))}
              </RadioGroup>
            </div>
            {selected ? (
              <div className="space-y-2">
                <Label>{t('order.billingCycle')}</Label>
                <Select value={cycle} onValueChange={(v) => setCycle(v as BillingCycle)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cycles.map((p) => (
                      <SelectItem key={p.id} value={p.billingCycle}>
                        {t(`cycle.${p.billingCycle}` as DictKey)} —{' '}
                        <Money amount={p.recurring} currency={p.currency} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {productId ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-2 font-medium">{t('services.prorationPreview')}</div>
                {preview.isPending ? (
                  <Skeleton className="h-16" />
                ) : preview.isError ? (
                  <ErrorState error={preview.error} compact />
                ) : (
                  <dl className="space-y-1">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('services.prorationCredit')}</dt>
                      <dd>
                        <Money
                          amount={-Math.abs(preview.data.credit)}
                          currency={preview.data.currency}
                        />
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {t('services.prorationCharge', {
                          date: fmtDate(preview.data.nextDueDate, locale),
                        })}
                      </dt>
                      <dd>
                        <Money amount={preview.data.charge} currency={preview.data.currency} />
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('common.tax')}</dt>
                      <dd>
                        <Money amount={preview.data.taxTotal} currency={preview.data.currency} />
                      </dd>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-medium">
                      <dt>{t('services.prorationTotal')}</dt>
                      <dd>
                        <Money amount={preview.data.total} currency={preview.data.currency} />
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!productId || !preview.isSuccess || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? t('common.submitting') : t('services.confirmUpgrade')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Cancel ---------- */
function CancelDialog({
  service,
  open,
  onOpenChange,
}: {
  service: ServiceDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [type, setType] = useState<CancellationType>('end_of_term');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => portalApi.services.cancel(service.id, { type, reason: reason || undefined }),
    onSuccess: () => {
      toast.success(t('services.cancelSubmitted'));
      qc.invalidateQueries({ queryKey: portalKeys.service(service.id) });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('services.cancelConfirmTitle')}</DialogTitle>
          <DialogDescription>{t('services.cancelHint')}</DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={type}
          onValueChange={(v) => setType(v as CancellationType)}
          className="gap-2"
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground">
            <RadioGroupItem value="end_of_term" className="mt-0.5" />
            <div>
              <div className="font-medium text-sm">{t('services.cancelEndOfTerm')}</div>
              <div className="text-muted-foreground text-xs">
                {t('services.cancelEndOfTermHint', { date: fmtDate(service.nextDueDate, locale) })}
              </div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground">
            <RadioGroupItem value="immediate" className="mt-0.5" />
            <div>
              <div className="font-medium text-sm">{t('services.cancelImmediate')}</div>
              <div className="text-muted-foreground text-xs">
                {t('services.cancelImmediateHint')}
              </div>
            </div>
          </label>
        </RadioGroup>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">{t('services.cancelReason')}</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.back')}
          </Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? t('common.submitting') : t('services.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- VPS panel ---------- */
function VpsPanel({ service }: { service: ServiceDetail }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h');
  const usage = useQuery({
    queryKey: portalKeys.serviceUsage(service.id, range),
    queryFn: async () => normalizeUsage((await portalApi.services.usage(service.id, range)).data),
    refetchInterval: 60_000,
  });
  const power = useMutation({
    mutationFn: (action: PowerAction) => portalApi.services.power(service.id, action),
    onSuccess: () => {
      toast.success(t('services.powerQueued'));
      setTimeout(
        () => qc.invalidateQueries({ queryKey: portalKeys.serviceUsage(service.id, range) }),
        5000,
      );
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const u = usage.data;
  const history = u?.history ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('services.power')}
            {u?.powerState && u.powerState !== 'unknown' ? (
              <StatusBadge status={u.powerState} />
            ) : null}
          </CardTitle>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['start', Power, 'services.powerStart'],
              ['reboot', RotateCw, 'services.powerReboot'],
              ['shutdown', PowerOff, 'services.powerShutdown'],
              ['stop', Square, 'services.powerStop'],
            ] as const
          ).map(([action, Icon, key]) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={power.isPending || service.status !== 'active'}
              onClick={() => power.mutate(action)}
            >
              <Icon className="size-4" />
              {t(key)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">{t('services.usage')}</h3>
          <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
            <TabsList className="h-8">
              <TabsTrigger value="1h" className="text-xs">
                1h
              </TabsTrigger>
              <TabsTrigger value="24h" className="text-xs">
                24h
              </TabsTrigger>
              <TabsTrigger value="7d" className="text-xs">
                7d
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {usage.isPending ? (
          <Skeleton className="h-40" />
        ) : usage.isError ? (
          <ErrorState error={usage.error} compact />
        ) : !u || (history.length === 0 && u.cpuPercent == null && u.diskUsedMb == null) ? (
          <p className="text-muted-foreground text-sm">{t('services.noUsage')}</p>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t('services.cpu')}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtPercent(u.cpuPercent)}
                  </span>
                </div>
                <UsageChart
                  label={t('services.cpu')}
                  data={history.map((p) => ({ t: p.t, v: p.cpu }))}
                  max={100}
                  unit="%"
                  hue="sky"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t('services.memory')}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtBytesFromMb(u.memoryUsedMb)}
                    {u.memoryLimitMb ? ` / ${fmtBytesFromMb(u.memoryLimitMb)}` : ''}
                  </span>
                </div>
                <UsageChart
                  label={t('services.memory')}
                  data={history.map((p) => ({ t: p.t, v: p.memMb }))}
                  max={u.memoryLimitMb ?? undefined}
                  format={fmtBytesFromMb}
                  hue="violet"
                />
              </div>
              <div className="lg:col-span-2">
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t('services.network')}</span>
                </div>
                <UsageChart
                  label={t('services.network')}
                  data={history.map((p) => ({ t: p.t, v: (p.netInMb ?? 0) + (p.netOutMb ?? 0) }))}
                  format={fmtBytesFromMb}
                  hue="emerald"
                  height={110}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <UsageMeter
                label={t('services.disk')}
                used={u.diskUsedMb}
                limit={u.diskLimitMb}
                format={fmtBytesFromMb}
              />
              <UsageMeter
                label={t('services.bandwidth')}
                used={u.bandwidthUsedMb}
                limit={u.bandwidthLimitMb}
                format={fmtBytesFromMb}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Hosting usage (non VPS) ---------- */
function HostingUsage({ service }: { service: ServiceDetail }) {
  const { t } = useI18n();
  const usage = useQuery({
    queryKey: portalKeys.serviceUsage(service.id, '24h'),
    queryFn: async () => normalizeUsage((await portalApi.services.usage(service.id)).data),
    retry: false,
  });
  if (usage.isError || usage.isPending) return null;
  const u = usage.data;
  if (u.diskUsedMb == null && u.bandwidthUsedMb == null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('services.usage')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <UsageMeter
          label={t('services.disk')}
          used={u.diskUsedMb}
          limit={u.diskLimitMb}
          format={fmtBytesFromMb}
        />
        <UsageMeter
          label={t('services.bandwidth')}
          used={u.bandwidthUsedMb}
          limit={u.bandwidthLimitMb}
          format={fmtBytesFromMb}
        />
      </CardContent>
    </Card>
  );
}

/* ---------- Page ---------- */
export function ServiceDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const [dialog, setDialog] = useState<'password' | 'upgrade' | 'cancel' | null>(null);
  const query = useQuery({
    queryKey: portalKeys.service(id),
    queryFn: async () => (await portalApi.services.get(id)).data,
  });
  const login = useMutation({
    mutationFn: () => portalApi.services.loginUrl(id),
    onSuccess: ({ data }) => window.open(data.url, '_blank', 'noopener'),
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });

  return (
    <QueryState query={query} skeleton={<DetailSkeleton />} kind="item">
      {(s) => {
        const canManage = s.status === 'active';
        return (
          <div className="space-y-6">
            <PageHeader
              back={{ href: '/portal/services', label: t('services.title') }}
              title={s.product?.name ?? t('services.product')}
              description={s.domain ?? s.username ?? undefined}
              badge={<StatusBadge status={s.status} />}
            >
              {s.capabilities?.loginUrl !== false ? (
                <Button
                  size="sm"
                  disabled={!canManage || login.isPending}
                  onClick={() => login.mutate()}
                >
                  <ExternalLink className="size-4" /> {t('services.loginPanel')}
                </Button>
              ) : null}
            </PageHeader>

            {s.status === 'suspended' ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {t('services.suspendedReason', { reason: s.suspendReason ?? '—' })}
                </AlertTitle>
                <AlertDescription>{t('services.suspendedPayHint')}</AlertDescription>
              </Alert>
            ) : null}
            {s.cancellationRequestedAt ? (
              <Alert>
                <AlertTitle>
                  {t('services.cancelRequested', {
                    date: fmtDate(s.cancellationRequestedAt, locale),
                  })}
                </AlertTitle>
              </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">{t('services.detailsTab')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <KeyValue
                    items={[
                      { label: t('services.product'), value: s.product?.name ?? '—' },
                      { label: t('common.status'), value: <StatusBadge status={s.status} /> },
                      { label: t('services.domain'), value: s.domain, hidden: !s.domain },
                      { label: t('services.username'), value: s.username, hidden: !s.username },
                      {
                        label: t('services.price'),
                        value: (
                          <>
                            <Money amount={s.recurringAmount} currency={s.currency} /> /{' '}
                            {t(`cycle.short.${s.billingCycle}` as DictKey)}
                          </>
                        ),
                      },
                      {
                        label: t('services.cycle'),
                        value: t(`cycle.${s.billingCycle}` as DictKey),
                      },
                      {
                        label: t('services.registered'),
                        value: fmtDate(s.registrationDate, locale),
                      },
                      { label: t('services.nextDue'), value: fmtDate(s.nextDueDate, locale) },
                    ]}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('services.manageTab')}</CardTitle>
                  <CardDescription>{t('common.actions')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {s.capabilities?.changePassword !== false ? (
                    <Button
                      variant="outline"
                      className="justify-start"
                      disabled={!canManage}
                      onClick={() => setDialog('password')}
                    >
                      <KeyRound className="size-4" /> {t('services.resetPassword')}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="justify-start"
                    disabled={!canManage}
                    onClick={() => setDialog('upgrade')}
                  >
                    <ArrowUpDown className="size-4" /> {t('services.upgrade')}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start text-destructive hover:text-destructive"
                    disabled={!canManage || Boolean(s.cancellationRequestedAt)}
                    onClick={() => setDialog('cancel')}
                  >
                    <XCircle className="size-4" /> {t('services.cancel')}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {isVps(s) ? <VpsPanel service={s} /> : <HostingUsage service={s} />}

            <ResetPasswordDialog
              service={s}
              open={dialog === 'password'}
              onOpenChange={(o) => setDialog(o ? 'password' : null)}
            />
            {dialog === 'upgrade' ? (
              <UpgradeDialog
                service={s}
                open
                onOpenChange={(o) => setDialog(o ? 'upgrade' : null)}
              />
            ) : null}
            <CancelDialog
              service={s}
              open={dialog === 'cancel'}
              onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
            />
          </div>
        );
      }}
    </QueryState>
  );
}

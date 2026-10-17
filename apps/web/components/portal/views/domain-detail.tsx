'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type DomainContact,
  type DomainContacts,
  domainContactSchema,
  nameserversSchema,
} from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Control, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { fmtDate, fmtRelativeDays } from '@/lib/portal/format';
import { portalKeys, useClientProfile } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import type { PortalDomain } from '@/lib/portal/types';
import { CopyButton } from '../copy-button';
import { KeyValue } from '../key-value';
import { Money } from '../money';
import { PageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { DetailSkeleton } from '../skeletons';
import { StatusBadge } from '../status-badge';

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/* ---------- Settings toggles ---------- */
function SettingToggle({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <Label htmlFor={id} className="font-medium text-sm">
          {label}
        </Label>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function SettingsTab({ domain }: { domain: PortalDomain }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (body: Partial<Pick<PortalDomain, 'autoRenew' | 'locked' | 'idProtection'>>) =>
      portalApi.domains.update(domain.id, body),
    onSuccess: ({ data }) => {
      qc.setQueryData(portalKeys.domain(domain.id), data);
      toast.success(t('domains.updated'));
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const active = domain.status === 'active';
  return (
    <Card>
      <CardContent className="divide-y">
        <SettingToggle
          id="auto-renew"
          label={t('domains.autoRenew')}
          hint={t('domains.autoRenewHint', { days: 14 })}
          checked={domain.autoRenew}
          onChange={(v) => update.mutate({ autoRenew: v })}
          disabled={update.isPending}
        />
        <SettingToggle
          id="lock"
          label={t('domains.lock')}
          hint={t('domains.lockHint')}
          checked={domain.locked}
          onChange={(v) => update.mutate({ locked: v })}
          disabled={update.isPending || !active}
        />
        <SettingToggle
          id="id-protection"
          label={t('domains.idProtection')}
          hint=""
          checked={domain.idProtection}
          onChange={(v) => update.mutate({ idProtection: v })}
          disabled={update.isPending || !active}
        />
      </CardContent>
    </Card>
  );
}

/* ---------- Nameservers ---------- */
const rowsToValues = (rows: { value: string }[]) => rows.map((r) => r.value.trim()).filter(Boolean);
const toRows = (ns: string[]) =>
  Array.from({ length: Math.max(5, ns.length) }, (_, i) => ({ value: ns[i] ?? '' }));

function NameserversTab({ domain }: { domain: PortalDomain }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const schema = z.object({
    ns: z.array(z.object({ value: z.string().trim() })).superRefine((rows, ctx) => {
      const parsed = nameserversSchema.min(2, t('val.minNs')).safeParse(rowsToValues(rows));
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message:
            parsed.error.issues[0]?.message === 'invalid hostname'
              ? t('val.nameserver')
              : (parsed.error.issues[0]?.message ?? t('val.nameserver')),
        });
      }
    }),
  });
  type In = z.infer<typeof schema>;
  const form = useForm<In>({
    resolver: zodResolver(schema),
    defaultValues: { ns: toRows(domain.nameservers) },
  });
  useEffect(() => {
    form.reset({ ns: toRows(domain.nameservers) });
  }, [domain.nameservers, form]);
  const m = useMutation({
    mutationFn: (ns: string[]) => portalApi.domains.update(domain.id, { nameservers: ns }),
    onSuccess: ({ data }) => {
      qc.setQueryData(portalKeys.domain(domain.id), data);
      toast.success(t('domains.nameserversSaved'));
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('domains.nameservers')}</CardTitle>
        <CardDescription>{t('domains.nameserversHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => m.mutate(rowsToValues(v.ns)))}
            className="space-y-3"
          >
            {form.watch('ns').map((_, i) => (
              <FormField
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position inputs
                key={i}
                control={form.control}
                name={`ns.${i}.value`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('domains.nameserver', { n: i + 1 })}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={`ns${i + 1}.example.com`}
                        autoCapitalize="none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            {form.formState.errors.ns?.root || form.formState.errors.ns?.message ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.ns.message ?? form.formState.errors.ns.root?.message}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={m.isPending || domain.status !== 'active'}>
                {m.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/* ---------- Contacts ---------- */
const emptyContact: DomainContact = {
  firstName: '',
  lastName: '',
  organization: '',
  email: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  postalCode: '',
  state: '',
  country: 'NL',
};

function ContactFieldset({
  control,
  prefix,
}: {
  control: Control<ContactsForm>;
  prefix: 'registrant' | 'admin' | 'tech' | 'billing';
}) {
  const { t } = useI18n();
  const f = (
    name: keyof DomainContact,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <FormField
      control={control}
      name={`${prefix}.${name}`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...props} {...field} value={field.value ?? ''} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {f('firstName', t('domains.firstName'))}
      {f('lastName', t('domains.lastName'))}
      <div className="sm:col-span-2">
        {f('organization', `${t('domains.organization')} (${t('common.optional')})`)}
      </div>
      {f('email', t('common.email'), { type: 'email' })}
      {f('phone', t('common.phone'), { type: 'tel', placeholder: '+31.612345678' })}
      <div className="sm:col-span-2">{f('address1', t('domains.address1'))}</div>
      <div className="sm:col-span-2">
        {f('address2', `${t('domains.address2')} (${t('common.optional')})`)}
      </div>
      {f('postalCode', t('domains.postalCode'))}
      {f('city', t('domains.city'))}
      {f('state', `${t('domains.state')} (${t('common.optional')})`)}
      {f('country', t('domains.country'), { maxLength: 2, className: 'uppercase' })}
    </div>
  );
}

const contactsFormSchema = z.object({
  registrant: domainContactSchema,
  admin: domainContactSchema.optional(),
  tech: domainContactSchema.optional(),
  billing: domainContactSchema.optional(),
});
type ContactsForm = z.infer<typeof contactsFormSchema>;

function ContactsTab({ domain }: { domain: PortalDomain }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const roles = ['admin', 'tech', 'billing'] as const;
  const [same, setSame] = useState<Record<(typeof roles)[number], boolean>>({
    admin: !domain.contacts?.admin,
    tech: !domain.contacts?.tech,
    billing: !domain.contacts?.billing,
  });
  const form = useForm<ContactsForm>({
    resolver: zodResolver(contactsFormSchema),
    defaultValues: {
      registrant: domain.contacts?.registrant ?? emptyContact,
      admin: domain.contacts?.admin ?? emptyContact,
      tech: domain.contacts?.tech ?? emptyContact,
      billing: domain.contacts?.billing ?? emptyContact,
    },
  });
  const m = useMutation({
    mutationFn: (contacts: DomainContacts) => portalApi.domains.update(domain.id, { contacts }),
    onSuccess: ({ data }) => {
      qc.setQueryData(portalKeys.domain(domain.id), data);
      toast.success(t('domains.contactsSaved'));
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const onSubmit = (v: ContactsForm) => {
    const clean = (c: DomainContact | undefined) =>
      c && {
        ...c,
        organization: c.organization || undefined,
        address2: c.address2 || undefined,
        state: c.state || undefined,
      };
    m.mutate({
      registrant: clean(v.registrant) as DomainContact,
      admin: same.admin ? undefined : clean(v.admin),
      tech: same.tech ? undefined : clean(v.tech),
      billing: same.billing ? undefined : clean(v.billing),
    });
  };
  const roleLabel = {
    admin: t('domains.adminContact'),
    tech: t('domains.techContact'),
    billing: t('domains.billingContact'),
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('domains.contacts')}</CardTitle>
        <CardDescription>{t('domains.contactsHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <section className="space-y-3">
              <h3 className="font-medium text-sm">{t('domains.registrant')}</h3>
              <ContactFieldset control={form.control} prefix="registrant" />
            </section>
            {roles.map((role) => (
              <section key={role} className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">{roleLabel[role]}</h3>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={same[role]}
                      onCheckedChange={(v) => setSame((s) => ({ ...s, [role]: Boolean(v) }))}
                    />
                    {t('domains.sameAsRegistrant')}
                  </label>
                </div>
                {!same[role] ? <ContactFieldset control={form.control} prefix={role} /> : null}
              </section>
            ))}
            <div className="flex justify-end">
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/* ---------- Renew + EPP ---------- */
function RenewDialog({
  domain,
  open,
  onOpenChange,
}: {
  domain: PortalDomain;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [years, setYears] = useState('1');
  const m = useMutation({
    mutationFn: () => portalApi.domains.renew(domain.id, Number(years)),
    onSuccess: (res) => {
      toast.success(t('domains.renewOrdered'));
      qc.invalidateQueries({ queryKey: portalKeys.domain(domain.id) });
      onOpenChange(false);
      if (res.invoiceId) window.location.assign(`/portal/invoices/${res.invoiceId}?pay=1`);
    },
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const price = domain.recurringAmount * Number(years);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('domains.renew')} · {domain.name}
          </DialogTitle>
          <DialogDescription>{t('domains.renewHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t('domains.renewPeriod')}</Label>
          <Select value={years} onValueChange={setYears}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 5].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y === 1 ? t('common.year1') : t('common.yearN', { count: y })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {t('common.total')}:{' '}
            <Money
              amount={price}
              currency={domain.currency}
              className="font-medium text-foreground"
            />{' '}
            ({t('common.excl')} {t('common.tax')})
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? t('common.submitting') : t('domains.renew')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EppDialog({
  domain,
  open,
  onOpenChange,
}: {
  domain: PortalDomain;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const m = useMutation({
    mutationFn: () => portalApi.domains.eppCode(domain.id),
    onError: (e) => toast.error(errMsg(e, t('common.somethingWrong'))),
  });
  const code = m.data?.data.eppCode ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('domains.epp')}</DialogTitle>
          <DialogDescription>{t('domains.eppHint')}</DialogDescription>
        </DialogHeader>
        {code ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
            <code className="flex-1 break-all font-mono text-sm">{code}</code>
            <CopyButton value={code} />
          </div>
        ) : m.isSuccess ? (
          <p className="text-muted-foreground text-sm">
            {t('status.queued')} — {t('common.retry')}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button disabled={m.isPending || domain.locked} onClick={() => m.mutate()}>
            <KeyRound className="size-4" />{' '}
            {m.isPending ? t('common.loading') : t('domains.getEpp')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Page ---------- */
export function DomainDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const [dialog, setDialog] = useState<'renew' | 'epp' | null>(
    params.get('renew') ? 'renew' : null,
  );
  useClientProfile();
  const query = useQuery({
    queryKey: portalKeys.domain(id),
    queryFn: async () => (await portalApi.domains.get(id)).data,
  });

  return (
    <QueryState query={query} skeleton={<DetailSkeleton />} kind="item">
      {(d) => (
        <div className="space-y-6">
          <PageHeader
            back={{ href: '/portal/domains', label: t('domains.title') }}
            title={d.name}
            badge={<StatusBadge status={d.status} />}
            description={
              d.expiryDate
                ? t('domains.expiresIn', { relative: fmtRelativeDays(d.expiryDate, locale) })
                : undefined
            }
          >
            <Button size="sm" variant="outline" onClick={() => setDialog('epp')}>
              <KeyRound className="size-4" /> {t('domains.getEpp')}
            </Button>
            <Button
              size="sm"
              onClick={() => setDialog('renew')}
              disabled={!['active', 'expired', 'redemption'].includes(d.status)}
            >
              <RefreshCw className="size-4" /> {t('domains.renew')}
            </Button>
          </PageHeader>

          <Card>
            <CardContent>
              <KeyValue
                items={[
                  { label: t('domains.registered'), value: fmtDate(d.registrationDate, locale) },
                  { label: t('domains.expiry'), value: fmtDate(d.expiryDate, locale) },
                  { label: t('services.nextDue'), value: fmtDate(d.nextDueDate, locale) },
                  {
                    label: t('domains.period'),
                    value:
                      d.registrationPeriod === 1
                        ? t('common.year1')
                        : t('common.yearN', { count: d.registrationPeriod }),
                  },
                  {
                    label: t('common.price'),
                    value: <Money amount={d.recurringAmount} currency={d.currency} />,
                  },
                  { label: t('domains.nameservers'), value: d.nameservers.join(', ') || '—' },
                ]}
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="settings">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="settings" className="flex-1">
                {t('domains.settingsTab')}
              </TabsTrigger>
              <TabsTrigger value="dns" className="flex-1">
                {t('domains.dnsTab')}
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex-1">
                {t('domains.contactsTab')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="mt-4">
              <SettingsTab domain={d} />
            </TabsContent>
            <TabsContent value="dns" className="mt-4">
              <NameserversTab domain={d} />
            </TabsContent>
            <TabsContent value="contacts" className="mt-4">
              <ContactsTab key={d.updatedAt.toString()} domain={d} />
            </TabsContent>
          </Tabs>

          <RenewDialog
            domain={d}
            open={dialog === 'renew'}
            onOpenChange={(o) => setDialog(o ? 'renew' : null)}
          />
          <EppDialog
            domain={d}
            open={dialog === 'epp'}
            onOpenChange={(o) => setDialog(o ? 'epp' : null)}
          />
        </div>
      )}
    </QueryState>
  );
}

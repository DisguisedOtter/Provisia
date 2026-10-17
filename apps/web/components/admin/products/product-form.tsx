'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type BillingCycle, createProductSchema, type ProductWithPrices } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminApi } from '@/lib/admin/api';
import { applyApiError } from '@/lib/admin/form-errors';
import { BILLING_CYCLE_LABELS, BILLING_CYCLES } from '@/lib/admin/format';
import type { JsonSchema } from '@/lib/admin/types';
import {
  FormGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from '../form-fields';
import { MoneyInput } from '../money';
import { defaultsFromJsonSchema, SchemaFields } from '../schema-form';
import { slugify } from './group-dialog';

const formSchema = createProductSchema.omit({ prices: true }).extend({
  prices: z.array(
    z.object({
      billingCycle: z.string(),
      enabled: z.boolean(),
      currency: z.string(),
      setupFee: z.number().int(),
      recurring: z.number().int(),
    }),
  ),
});
type Values = z.input<typeof formSchema>;

export function ProductForm({ product }: { product?: ProductWithPrices }) {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ['product-groups'],
    queryFn: () => adminApi.productGroups.list(),
  });
  const provisioners = useQuery({
    queryKey: ['modules', 'provisioner'],
    queryFn: () => adminApi.modules.list('provisioner'),
    retry: false,
  });
  const servers = useQuery({
    queryKey: ['servers', 'lookup'],
    queryFn: () => adminApi.lookup.servers(),
    retry: false,
  });

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      groupId: product?.groupId ?? sp.get('groupId') ?? '',
      name: product?.name ?? '',
      slug: product?.slug ?? '',
      description: product?.description ?? null,
      type: product?.type ?? 'hosting',
      module: product?.module ?? null,
      moduleConfig: product?.moduleConfig ?? {},
      serverGroup: product?.serverGroup ?? null,
      taxable: product?.taxable ?? true,
      requiresDomain: product?.requiresDomain ?? false,
      stockControl: product?.stockControl ?? false,
      stock: product?.stock ?? 0,
      hidden: product?.hidden ?? false,
      sortOrder: product?.sortOrder ?? 0,
      prices: BILLING_CYCLES.map((cycle) => {
        const existing = product?.prices.find((p) => p.billingCycle === cycle);
        return {
          billingCycle: cycle,
          enabled: Boolean(existing),
          currency: existing?.currency ?? 'EUR',
          setupFee: existing?.setupFee ?? 0,
          recurring: existing?.recurring ?? 0,
        };
      }),
    },
  });

  const moduleId = useWatch({ control: form.control, name: 'module' });
  const stockControl = useWatch({ control: form.control, name: 'stockControl' });
  const prices = useWatch({ control: form.control, name: 'prices' });
  const selectedModule = provisioners.data?.data.find((m) => m.id === moduleId);
  const schema = selectedModule?.configSchema as JsonSchema | undefined;

  // Seed module config defaults when switching module.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to module changes
  useEffect(() => {
    if (!schema) return;
    const current = form.getValues('moduleConfig') ?? {};
    if (product && product.module === moduleId && Object.keys(current).length) return;
    form.setValue('moduleConfig', { ...defaultsFromJsonSchema(schema), ...current });
  }, [moduleId, schema]);

  const serverGroups = useMemo(() => {
    const set = new Set<string>();
    for (const s of servers.data?.data ?? []) if (s.groupName) set.add(s.groupName);
    if (product?.serverGroup) set.add(product.serverGroup);
    return [...set];
  }, [servers.data, product]);

  const save = useMutation({
    mutationFn: (v: Values) => {
      const parsed = formSchema.parse(v);
      const body = {
        ...parsed,
        module: parsed.module || null,
        serverGroup: parsed.serverGroup || null,
        prices: parsed.prices
          .filter((p) => p.enabled)
          .map((p) => ({
            billingCycle: p.billingCycle as BillingCycle,
            currency: p.currency,
            setupFee: p.setupFee,
            recurring: p.recurring,
          })),
      };
      return product ? adminApi.products.update(product.id, body) : adminApi.products.create(body);
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(product ? 'Product saved' : 'Product created');
      router.push(product ? '/admin/products' : `/admin/products/${data.id}`);
    },
    onError: (e) => applyApiError(e, form.setError),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        onBlurCapture={(e) => {
          if ((e.target as unknown as HTMLInputElement).name === 'name' && !form.getValues('slug'))
            form.setValue('slug', slugify(form.getValues('name')));
        }}
        className="space-y-6"
      >
        <Card>
          <CardContent className="space-y-8">
            <FormSection title="General">
              <FormGrid>
                <TextField control={form.control} name="name" label="Name" />
                <TextField control={form.control} name="slug" label="Slug" />
                <SelectField
                  control={form.control}
                  name="groupId"
                  label="Group"
                  options={(groups.data?.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                />
                <SelectField
                  control={form.control}
                  name="type"
                  label="Type"
                  options={['hosting', 'vps', 'domain', 'other'].map((t) => ({
                    value: t,
                    label: t.charAt(0).toUpperCase() + t.slice(1),
                  }))}
                />
                <TextareaField
                  control={form.control}
                  name="description"
                  label="Description"
                  className="sm:col-span-2"
                  nullable
                  description="Shown in the order form; Markdown allowed."
                />
              </FormGrid>
            </FormSection>

            <FormSection
              title="Pricing"
              description="Enable the billing cycles you offer. Amounts exclude VAT."
            >
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Billing cycle</TableHead>
                      <TableHead className="text-right">Setup fee</TableHead>
                      <TableHead className="text-right">Recurring price</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Per month</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BILLING_CYCLES.map((cycle, i) => {
                      const row = prices?.[i];
                      const months = {
                        monthly: 1,
                        quarterly: 3,
                        semiannually: 6,
                        annually: 12,
                        biennially: 24,
                        triennially: 36,
                        onetime: 0,
                      }[cycle];
                      return (
                        <TableRow key={cycle}>
                          <TableCell>
                            <Checkbox
                              checked={Boolean(row?.enabled)}
                              onCheckedChange={(c) =>
                                form.setValue(`prices.${i}.enabled`, Boolean(c))
                              }
                              aria-label={`Enable ${BILLING_CYCLE_LABELS[cycle]}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {BILLING_CYCLE_LABELS[cycle]}
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyInput
                              className="ml-auto w-32"
                              value={row?.setupFee ?? 0}
                              onChange={(v) => form.setValue(`prices.${i}.setupFee`, v)}
                              disabled={!row?.enabled}
                              aria-label={`${BILLING_CYCLE_LABELS[cycle]} setup fee`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyInput
                              className="ml-auto w-32"
                              value={row?.recurring ?? 0}
                              onChange={(v) => form.setValue(`prices.${i}.recurring`, v)}
                              disabled={!row?.enabled}
                              aria-label={`${BILLING_CYCLE_LABELS[cycle]} price`}
                            />
                          </TableCell>
                          <TableCell className="hidden text-right text-muted-foreground tabular-nums lg:table-cell">
                            {row?.enabled && months > 0
                              ? `€ ${((row.recurring ?? 0) / 100 / months).toFixed(2)}`
                              : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </FormSection>

            <FormSection
              title="Provisioning module"
              description="The module creates and manages the service on a server when the order is accepted."
            >
              <FormGrid>
                <SelectField
                  control={form.control}
                  name="module"
                  label="Module"
                  nullable
                  options={(provisioners.data?.data ?? []).map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.version})`,
                  }))}
                  placeholder={
                    provisioners.isPending
                      ? 'Loading modules…'
                      : provisioners.isError
                        ? 'Module list unavailable'
                        : 'No module (manual)'
                  }
                  description={
                    provisioners.isError
                      ? 'GET /admin/modules?kind=provisioner is not available yet.'
                      : undefined
                  }
                />
                <SelectField
                  control={form.control}
                  name="serverGroup"
                  label="Server group"
                  nullable
                  options={serverGroups.map((g) => ({ value: g, label: g }))}
                  description="Services are placed on the least-loaded active server in this group."
                />
              </FormGrid>
              {moduleId ? (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <h3 className="mb-3 font-medium text-sm">
                    {selectedModule?.name ?? moduleId} configuration
                  </h3>
                  <SchemaFields
                    control={form.control}
                    schema={schema}
                    prefix="moduleConfig"
                    context={{
                      serverId: servers.data?.data.find((s) => s.module === moduleId)?.id,
                    }}
                  />
                </div>
              ) : null}
            </FormSection>

            <FormSection title="Options">
              <FormGrid>
                <SwitchField
                  control={form.control}
                  name="taxable"
                  label="Taxable"
                  description="Apply VAT according to the client's tax rule."
                />
                <SwitchField
                  control={form.control}
                  name="requiresDomain"
                  label="Requires a domain"
                  description="Ask for a hostname during ordering."
                />
                <SwitchField
                  control={form.control}
                  name="hidden"
                  label="Hidden"
                  description="Not orderable from the portal."
                />
                <SwitchField control={form.control} name="stockControl" label="Stock control" />
                {stockControl ? (
                  <TextField control={form.control} name="stock" label="Stock" type="number" />
                ) : null}
                <TextField
                  control={form.control}
                  name="sortOrder"
                  label="Sort order"
                  type="number"
                />
              </FormGrid>
            </FormSection>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/admin/products')}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            {product ? 'Save product' : 'Create product'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

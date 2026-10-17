'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createServerSchema, type Server, updateServerSchema } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError } from '@/lib/admin/form-errors';
import type { JsonSchema } from '@/lib/admin/types';
import { FormGrid, SelectField, SwitchField, TextareaField, TextField } from '../form-fields';
import { defaultsFromJsonSchema, SchemaFields } from '../schema-form';

const formSchema = createServerSchema.extend({ nameserversText: z.string().default('') });
type Values = z.input<typeof formSchema>;

export function ServerDialog({ server, onClose }: { server: Server | null; onClose: () => void }) {
  const qc = useQueryClient();
  const provisioners = useQuery({
    queryKey: ['modules', 'provisioner'],
    queryFn: () => adminApi.modules.list('provisioner'),
    retry: false,
  });
  const groups = useQuery({
    queryKey: ['server-groups'],
    queryFn: () => adminApi.servers.groups.list(),
    retry: false,
  });
  const form = useForm<Values>({
    resolver: zodResolver(
      server ? formSchema.partial().required({ nameserversText: true }) : formSchema,
    ) as never,
    defaultValues: {
      name: server?.name ?? '',
      module: server?.module ?? '',
      hostname: server?.hostname ?? '',
      ipAddress: server?.ipAddress ?? null,
      port: server?.port ?? null,
      secure: server?.secure ?? true,
      credentials: {},
      nameservers: server?.nameservers ?? [],
      nameserversText: server?.nameservers.join('\n') ?? '',
      groupName: server?.groupName ?? null,
      maxAccounts: server?.maxAccounts ?? 0,
      active: server?.active ?? true,
      notes: server?.notes ?? null,
    },
  });
  const moduleId = useWatch({ control: form.control, name: 'module' });
  const mod = provisioners.data?.data.find((m) => m.id === moduleId);
  const credSchema = (mod?.credentialsSchema ?? undefined) as JsonSchema | undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: seed defaults on module change only
  useEffect(() => {
    if (!credSchema || server) return;
    form.setValue('credentials', defaultsFromJsonSchema(credSchema));
  }, [moduleId]);

  const m = useMutation({
    mutationFn: (v: Values) => {
      const nameservers = (v.nameserversText ?? '')
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const creds = Object.fromEntries(
        Object.entries(v.credentials ?? {}).filter(
          ([, val]) => val !== '' && val !== null && val !== undefined,
        ),
      );
      if (server) {
        const body = updateServerSchema.parse({
          ...v,
          nameservers,
          credentials: Object.keys(creds).length ? creds : undefined,
          nameserversText: undefined,
        });
        return adminApi.servers.update(server.id, body);
      }
      return adminApi.servers.create(
        createServerSchema.parse({ ...v, nameservers, credentials: creds }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast.success(server ? 'Server updated' : 'Server added');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : 'Add server'}</DialogTitle>
          <DialogDescription>
            {server
              ? 'Leave credential fields empty to keep the stored values.'
              : 'Credentials are validated against the module and encrypted before storage.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormGrid>
              <TextField control={form.control} name="name" label="Name" placeholder="web01" />
              <SelectField
                control={form.control}
                name="module"
                label="Module"
                options={(provisioners.data?.data ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                placeholder={
                  provisioners.isError ? 'Module list unavailable — type below' : 'Select module'
                }
                disabled={Boolean(server)}
              />
              {provisioners.isError ? (
                <TextField
                  control={form.control}
                  name="module"
                  label="Module id"
                  placeholder="cpanel"
                />
              ) : null}
              <TextField
                control={form.control}
                name="hostname"
                label="Hostname"
                placeholder="web01.example.com"
              />
              <TextField control={form.control} name="ipAddress" label="IP address" nullable />
              <TextField
                control={form.control}
                name="port"
                label="Port"
                type="number"
                nullable
                description="Empty = module default."
              />
              <SwitchField control={form.control} name="secure" label="Use TLS" />
              <SelectField
                control={form.control}
                name="groupName"
                label="Server group"
                nullable
                options={(groups.data?.data ?? []).map((g) => ({ value: g.name, label: g.name }))}
              />
              <TextField
                control={form.control}
                name="maxAccounts"
                label="Max accounts"
                type="number"
                description="0 = unlimited."
              />
              <TextareaField
                control={form.control}
                name="nameserversText"
                label="Nameservers"
                description="One per line; used in welcome emails."
                className="sm:col-span-2"
              />
              <SwitchField
                control={form.control}
                name="active"
                label="Active"
                description="Inactive servers receive no new services."
              />
            </FormGrid>
            <div className="rounded-lg border bg-muted/30 p-4">
              <h3 className="mb-3 font-medium text-sm">Credentials</h3>
              {credSchema ? (
                <SchemaFields control={form.control} schema={credSchema} prefix="credentials" />
              ) : (
                <FormGrid>
                  <TextField
                    control={form.control}
                    name="credentials.username"
                    label="Username"
                    nullable
                  />
                  <TextField
                    control={form.control}
                    name="credentials.password"
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    nullable
                  />
                  <TextField
                    control={form.control}
                    name="credentials.apiToken"
                    label="API token"
                    type="password"
                    autoComplete="new-password"
                    nullable
                    className="sm:col-span-2"
                  />
                </FormGrid>
              )}
            </div>
            <TextareaField control={form.control} name="notes" label="Notes" nullable />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : null}{' '}
                {server ? 'Save' : 'Add server'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

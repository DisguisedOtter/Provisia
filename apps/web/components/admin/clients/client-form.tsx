'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type ClientWithUser,
  clientStatusSchema,
  createClientSchema,
  updateClientSchema,
} from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { COUNTRY_OPTIONS, EU_COUNTRIES, LANGUAGE_OPTIONS } from '@/lib/admin/countries';
import { applyApiError } from '@/lib/admin/form-errors';
import { CLIENT_STATUS } from '@/lib/admin/status';
import { FormGrid, FormSection, SelectField, TextareaField, TextField } from '../form-fields';

const createFormSchema = createClientSchema;
const editFormSchema = updateClientSchema.extend({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  status: clientStatusSchema,
});
type CreateValues = z.input<typeof createFormSchema>;
type EditValues = z.input<typeof editFormSchema>;

export function ClientForm({ client }: { client?: ClientWithUser }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = Boolean(client);

  const form = useForm<CreateValues | EditValues>({
    resolver: zodResolver(editing ? editFormSchema : createFormSchema) as never,
    defaultValues: client
      ? {
          firstName: client.firstName,
          lastName: client.lastName,
          companyName: client.companyName,
          vatNumber: client.vatNumber,
          address1: client.address1,
          address2: client.address2,
          city: client.city,
          postalCode: client.postalCode,
          state: client.state,
          country: client.country,
          phone: client.phone,
          language: client.language,
          currency: client.currency,
          notes: client.notes,
          status: client.status,
        }
      : {
          email: '',
          password: undefined,
          firstName: '',
          lastName: '',
          companyName: null,
          vatNumber: null,
          address1: '',
          address2: null,
          city: '',
          postalCode: '',
          state: null,
          country: 'NL',
          phone: null,
          language: 'en',
          currency: 'EUR',
          notes: null,
        },
  });

  const country = form.watch('country');
  const inEu = EU_COUNTRIES.has(String(country ?? ''));

  const save = useMutation({
    mutationFn: (values: CreateValues | EditValues) => {
      if (client) return adminApi.clients.update(client.id, editFormSchema.parse(values));
      const v = createFormSchema.parse(values);
      if (!v.password) v.password = undefined;
      return adminApi.clients.create(v);
    },
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast.success(editing ? 'Client updated' : 'Client created');
      router.push(`/admin/clients/${data.id}`);
    },
    onError: (err) => applyApiError(err, form.setError),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-6">
        <Card>
          <CardContent className="space-y-8">
            <FormSection
              title="Account"
              description={
                editing
                  ? 'Login email is managed from the Summary tab.'
                  : 'The client logs in to the portal with these credentials.'
              }
            >
              <FormGrid>
                {!editing ? (
                  <>
                    <TextField
                      control={form.control}
                      name="email"
                      label="Email"
                      type="email"
                      autoComplete="off"
                    />
                    <TextField
                      control={form.control}
                      name="password"
                      label="Password (optional)"
                      type="password"
                      autoComplete="new-password"
                      description="Leave empty to send a set-password email."
                      nullable
                    />
                  </>
                ) : null}
                <TextField control={form.control} name="firstName" label="First name" />
                <TextField control={form.control} name="lastName" label="Last name" />
                {editing ? (
                  <SelectField
                    control={form.control}
                    name="status"
                    label="Status"
                    options={Object.entries(CLIENT_STATUS).map(([value, v]) => ({
                      value,
                      label: v.label,
                    }))}
                  />
                ) : null}
              </FormGrid>
            </FormSection>

            <FormSection
              title="Company & VAT"
              description="For EU B2B clients a valid VAT number enables reverse charge (0%)."
            >
              <FormGrid>
                <TextField
                  control={form.control}
                  name="companyName"
                  label="Company name"
                  nullable
                />
                <TextField
                  control={form.control}
                  name="vatNumber"
                  label="VAT number"
                  placeholder={inEu ? `${country}123456789B01` : 'Optional'}
                  description={
                    inEu
                      ? 'Validated against VIES after saving.'
                      : 'Non-EU clients are billed at 0% (export).'
                  }
                  nullable
                />
              </FormGrid>
            </FormSection>

            <FormSection title="Billing address">
              <FormGrid>
                <TextField
                  control={form.control}
                  name="address1"
                  label="Address"
                  className="sm:col-span-2"
                />
                <TextField
                  control={form.control}
                  name="address2"
                  label="Address line 2"
                  className="sm:col-span-2"
                  nullable
                />
                <TextField control={form.control} name="postalCode" label="Postal code" />
                <TextField control={form.control} name="city" label="City" />
                <TextField control={form.control} name="state" label="State / province" nullable />
                <SelectField
                  control={form.control}
                  name="country"
                  label="Country"
                  options={COUNTRY_OPTIONS}
                />
                <TextField control={form.control} name="phone" label="Phone" type="tel" nullable />
              </FormGrid>
            </FormSection>

            <FormSection title="Preferences">
              <FormGrid>
                <SelectField
                  control={form.control}
                  name="language"
                  label="Language"
                  options={LANGUAGE_OPTIONS}
                />
                <SelectField
                  control={form.control}
                  name="currency"
                  label="Currency"
                  options={[
                    { value: 'EUR', label: 'EUR — Euro' },
                    { value: 'USD', label: 'USD — US Dollar' },
                    { value: 'GBP', label: 'GBP — Pound Sterling' },
                  ]}
                  disabled={editing}
                  description={editing ? 'Currency cannot change once invoices exist.' : undefined}
                />
                <TextareaField
                  control={form.control}
                  name="notes"
                  label="Internal notes"
                  className="sm:col-span-2"
                  nullable
                />
              </FormGrid>
            </FormSection>
          </CardContent>
        </Card>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            {editing ? 'Save changes' : 'Create client'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

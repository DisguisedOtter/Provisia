'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { portalApi } from '@/lib/portal/api';
import { portalKeys } from '@/lib/portal/hooks';
import { useI18n } from '@/lib/portal/i18n';
import { AttachmentsInput } from '../attachments-input';
import { ErrorState } from '../error-boundary';
import { PageHeader } from '../page-header';
import { FormSkeleton } from '../skeletons';

export function TicketNewView() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [files, setFiles] = useState<File[]>([]);
  const schema = z.object({
    departmentId: z.string().min(1, t('val.required')),
    subject: z.string().min(1, t('val.required')).max(255),
    body: z.string().min(1, t('val.required')).max(50_000),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    related: z.string(),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      departmentId: '',
      subject: '',
      body: '',
      priority: 'medium',
      related: params.get('serviceId')
        ? `service:${params.get('serviceId')}`
        : params.get('domainId')
          ? `domain:${params.get('domainId')}`
          : 'none',
    },
  });
  const departments = useQuery({
    queryKey: portalKeys.departments,
    queryFn: async () => (await portalApi.tickets.departments()).data,
  });
  const services = useQuery({
    queryKey: portalKeys.services({ perPage: 100 }),
    queryFn: () => portalApi.services.list({ perPage: 100 }),
    retry: false,
  });
  const domains = useQuery({
    queryKey: portalKeys.domains({ perPage: 100 }),
    queryFn: () => portalApi.domains.list({ perPage: 100 }),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async (v: Values) => {
      const uploaded = await Promise.all(files.map((f) => portalApi.tickets.uploadAttachment(f)));
      const [kind, id] = v.related.split(':');
      return portalApi.tickets.create({
        departmentId: v.departmentId,
        subject: v.subject,
        body: v.body,
        priority: v.priority,
        serviceId: kind === 'service' ? id : undefined,
        domainId: kind === 'domain' ? id : undefined,
        attachmentIds: uploaded.map((u) => u.data.id),
      });
    },
    onSuccess: ({ data }) => {
      toast.success(t('tickets.created', { number: data.number }));
      router.push(`/portal/tickets/${data.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: '/portal/tickets', label: t('tickets.title') }}
        title={t('tickets.new')}
        description={t('tickets.description')}
      />
      <Card>
        <CardContent>
          {departments.isPending ? (
            <FormSkeleton />
          ) : departments.isError ? (
            <ErrorState error={departments.error} onRetry={() => departments.refetch()} />
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="departmentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('tickets.department')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {departments.data.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('tickets.priority')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                              <SelectItem key={p} value={p}>
                                {t(`tickets.priority.${p}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="related"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('tickets.related')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t('tickets.relatedNone')}</SelectItem>
                          {(services.data?.data ?? []).map((s) => (
                            <SelectItem key={s.id} value={`service:${s.id}`}>
                              {t('tickets.relatedService', {
                                name: `${s.product?.name ?? t('services.product')}${s.domain ? ` (${s.domain})` : ''}`,
                              })}
                            </SelectItem>
                          ))}
                          {(domains.data?.data ?? []).map((d) => (
                            <SelectItem key={d.id} value={`domain:${d.id}`}>
                              {t('tickets.relatedDomain', { name: d.name })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('tickets.subject')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="body"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('tickets.message')}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={8}
                          placeholder={t('tickets.messagePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <AttachmentsInput files={files} onChange={setFiles} />
                <div className="flex justify-end">
                  <Button type="submit" disabled={submit.isPending}>
                    {submit.isPending ? t('common.submitting') : t('tickets.submit')}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

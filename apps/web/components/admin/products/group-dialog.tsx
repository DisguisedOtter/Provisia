'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createProductGroupSchema, type ProductGroup } from '@provisia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { adminApi } from '@/lib/admin/api';
import { applyApiError } from '@/lib/admin/form-errors';
import { FormGrid, SwitchField, TextareaField, TextField } from '../form-fields';

type Values = z.input<typeof createProductGroupSchema>;

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function GroupDialog({
  group,
  onClose,
}: {
  group: ProductGroup | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(createProductGroupSchema),
    defaultValues: group
      ? {
          name: group.name,
          slug: group.slug,
          description: group.description,
          sortOrder: group.sortOrder,
          hidden: group.hidden,
        }
      : { name: '', slug: '', description: null, sortOrder: 0, hidden: false },
  });
  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = createProductGroupSchema.parse(v);
      return group
        ? adminApi.productGroups.update(group.id, body)
        : adminApi.productGroups.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-groups'] });
      toast.success(group ? 'Group updated' : 'Group created');
      onClose();
    },
    onError: (e) => applyApiError(e, form.setError),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Edit group' : 'New product group'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4">
            <FormGrid>
              <TextField control={form.control} name="name" label="Name" />
              <TextField
                control={form.control}
                name="slug"
                label="Slug"
                description="URL-safe identifier."
              />
            </FormGrid>
            <TextareaField control={form.control} name="description" label="Description" nullable />
            <FormGrid>
              <TextField control={form.control} name="sortOrder" label="Sort order" type="number" />
              <SwitchField
                control={form.control}
                name="hidden"
                label="Hidden"
                description="Not shown in the order form."
              />
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={m.isPending}
                onClick={() => {
                  if (!form.getValues('slug'))
                    form.setValue('slug', slugify(form.getValues('name')));
                }}
              >
                {m.isPending ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

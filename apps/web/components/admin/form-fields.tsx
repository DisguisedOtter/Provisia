'use client';

import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FormControl,
  FormDescription,
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from './money';

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  description?: string;
  className?: string;
  disabled?: boolean;
};

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  type = 'text',
  placeholder,
  autoComplete,
  nullable,
}: Base<T> & {
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  /** Empty string is stored as null. */
  nullable?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label ? <FormLabel>{label}</FormLabel> : null}
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              autoComplete={autoComplete}
              disabled={disabled}
              {...field}
              value={field.value ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (type === 'number')
                  field.onChange(v === '' ? (nullable ? null : '') : Number(v));
                else field.onChange(nullable && v === '' ? null : v);
              }}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  placeholder,
  rows,
  nullable,
}: Base<T> & { placeholder?: string; rows?: number; nullable?: boolean }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label ? <FormLabel>{label}</FormLabel> : null}
          <FormControl>
            <Textarea
              placeholder={placeholder}
              rows={rows}
              disabled={disabled}
              {...field}
              value={field.value ?? ''}
              onChange={(e) =>
                field.onChange(nullable && e.target.value === '' ? null : e.target.value)
              }
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  options,
  placeholder = 'Select…',
  nullable,
}: Base<T> & {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  /** Adds a "None" option that stores null. */
  nullable?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label ? <FormLabel>{label}</FormLabel> : null}
          <Select
            value={
              field.value == null || field.value === ''
                ? nullable
                  ? '__none'
                  : ''
                : String(field.value)
            }
            onValueChange={(v) => field.onChange(v === '__none' ? null : v)}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {nullable ? <SelectItem value="__none">None</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
}: Base<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div className="space-y-0.5">
              {label ? <FormLabel>{label}</FormLabel> : null}
              {description ? <FormDescription>{description}</FormDescription> : null}
            </div>
            <FormControl>
              <Switch
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                disabled={disabled}
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
}: Base<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <div className="flex items-start gap-2">
            <FormControl>
              <Checkbox
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                disabled={disabled}
              />
            </FormControl>
            <div className="space-y-0.5 leading-none">
              {label ? <FormLabel className="font-normal">{label}</FormLabel> : null}
              {description ? <FormDescription>{description}</FormDescription> : null}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function MoneyField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  currency,
}: Base<T> & { currency?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label ? <FormLabel>{label}</FormLabel> : null}
          <FormControl>
            <MoneyInput
              value={field.value}
              onChange={field.onChange}
              currency={currency}
              disabled={disabled}
              onBlur={field.onBlur}
              name={field.name}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  nullable,
}: Base<T> & { nullable?: boolean }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label ? <FormLabel>{label}</FormLabel> : null}
          <FormControl>
            <Input
              type="date"
              disabled={disabled}
              {...field}
              value={field.value ?? ''}
              onChange={(e) =>
                field.onChange(e.target.value === '' ? (nullable ? null : '') : e.target.value)
              }
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function FormGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className ?? 'grid gap-4 sm:grid-cols-2'}>{children}</div>;
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium text-base">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { z } from 'zod';
import { adminApi } from '@/lib/admin/api';
import { titleCase } from '@/lib/admin/format';
import type { JsonSchema } from '@/lib/admin/types';
import { CheckboxField, SelectField, TextareaField, TextField } from './form-fields';

/**
 * Renders a react-hook-form field set from a module's JSON-schema `configSchema`
 * (zod → JSON schema on the API). Supports string / number / integer / boolean / enum
 * and remote option lists via the `x-options` extension (e.g. package list from a server).
 * Values live under `prefix` (default `moduleConfig`) in the form.
 */
export function SchemaFields<T extends FieldValues>({
  control,
  schema,
  prefix = 'moduleConfig',
  context = {},
}: {
  control: Control<T>;
  schema: JsonSchema | undefined;
  prefix?: string;
  /** Replaces `:name` placeholders in `x-options.endpoint`, e.g. `{ serverId }`. */
  context?: Record<string, string | undefined>;
}) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">This module has no configuration options.</p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {keys.map((key) => (
        <SchemaField
          key={key}
          control={control}
          name={`${prefix}.${key}` as FieldPath<T>}
          fieldKey={key}
          schema={props[key] as JsonSchema}
          required={required.has(key)}
          context={context}
        />
      ))}
    </div>
  );
}

function SchemaField<T extends FieldValues>({
  control,
  name,
  fieldKey,
  schema,
  required,
  context,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  fieldKey: string;
  schema: JsonSchema;
  required: boolean;
  context: Record<string, string | undefined>;
}) {
  const label = `${schema.title ?? titleCase(fieldKey)}${required ? '' : ' (optional)'}`;
  const description = schema.description;
  const type = resolveType(schema);
  const rawRemote = schema['x-options'];
  const remote = typeof rawRemote === 'string' ? { endpoint: rawRemote } : rawRemote;

  if (remote) {
    return (
      <RemoteSelectField
        control={control}
        name={name}
        label={label}
        description={description}
        endpoint={remote.endpoint}
        labelKey={remote.labelKey ?? 'name'}
        valueKey={remote.valueKey ?? 'id'}
        context={context}
      />
    );
  }
  const enumValues =
    schema.enum ??
    schema.anyOf?.map((s) => s.const).filter((v) => v !== undefined) ??
    schema.oneOf?.map((s) => s.const).filter((v) => v !== undefined);
  if (enumValues && enumValues.length > 0) {
    return (
      <SelectField
        control={control}
        name={name}
        label={label}
        description={description}
        options={enumValues.map((v) => ({ value: String(v), label: titleCase(String(v)) }))}
        nullable={!required}
      />
    );
  }
  if (type === 'boolean' || schema['x-widget'] === 'checkbox') {
    return (
      <CheckboxField
        control={control}
        name={name}
        label={label}
        description={description}
        className="sm:col-span-2"
      />
    );
  }
  if (type === 'number' || type === 'integer') {
    return (
      <TextField
        control={control}
        name={name}
        label={label}
        description={description}
        type="number"
        nullable={!required}
      />
    );
  }
  if (schema['x-widget'] === 'textarea' || (schema.maxLength ?? 0) > 500) {
    return (
      <TextareaField
        control={control}
        name={name}
        label={label}
        description={description}
        className="sm:col-span-2"
        nullable={!required}
      />
    );
  }
  const secret =
    schema['x-secret'] ||
    schema['x-widget'] === 'password' ||
    schema.format === 'password' ||
    /password|secret|token|key$/i.test(fieldKey);
  return (
    <TextField
      control={control}
      name={name}
      label={label}
      description={description}
      type={
        secret ? 'password' : schema.format === 'uri' || schema.format === 'url' ? 'url' : 'text'
      }
      autoComplete={secret ? 'new-password' : 'off'}
      nullable={!required}
    />
  );
}

function RemoteSelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  endpoint,
  labelKey,
  valueKey,
  context,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  endpoint: string;
  labelKey: string;
  valueKey: string;
  context: Record<string, string | undefined>;
}) {
  const resolved = useMemo(() => {
    let e = endpoint.replace(/^\/api\/v1/, '');
    let missing = false;
    e = e.replace(/:(\w+)/g, (_, k: string) => {
      const v = context[k];
      if (!v) missing = true;
      return v ?? '';
    });
    return missing ? null : e;
  }, [endpoint, context]);
  const q = useQuery({
    queryKey: ['schema-options', resolved],
    queryFn: () => adminApi.modules.options(resolved as string),
    enabled: Boolean(resolved),
  });
  const options = (q.data?.data ?? []).map((o) => ({
    value: String(o[valueKey] ?? o.id ?? o.name),
    label: String(o[labelKey] ?? o.name ?? o.id),
  }));
  return (
    <SelectField
      control={control}
      name={name}
      label={label}
      description={
        !resolved
          ? 'Select a server first to load options.'
          : q.isError
            ? 'Could not load options; enter a value below.'
            : description
      }
      options={options}
      placeholder={q.isPending && resolved ? 'Loading…' : 'Select…'}
      nullable
    />
  );
}

function resolveType(s: JsonSchema): string | undefined {
  if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null');
  if (s.type) return s.type;
  const alt = s.anyOf?.find((a) => a.type && a.type !== 'null');
  return alt ? resolveType(alt) : undefined;
}

/** Builds a loose zod validator from the JSON schema so required fields are enforced client-side. */
export function zodFromJsonSchema(
  schema: JsonSchema | undefined,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  const required = new Set(schema?.required ?? []);
  for (const [k, s] of Object.entries(schema?.properties ?? {})) {
    const t = resolveType(s as JsonSchema);
    let v: z.ZodType;
    if (t === 'boolean') v = z.boolean();
    else if (t === 'number' || t === 'integer') v = z.coerce.number();
    else v = z.string();
    if (required.has(k)) {
      if (t === 'string' || t === undefined) v = z.string().min(1, 'Required');
    } else {
      v = v.nullable().optional();
    }
    shape[k] = v;
  }
  return z.object(shape).passthrough() as unknown as z.ZodType<Record<string, unknown>>;
}

/** Default values for a schema: declared defaults, else empty per type. */
export function defaultsFromJsonSchema(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema?.properties ?? {})) {
    const js = s as JsonSchema;
    if (js.default !== undefined) out[k] = js.default;
    else if (resolveType(js) === 'boolean') out[k] = false;
    else out[k] = '';
  }
  return out;
}

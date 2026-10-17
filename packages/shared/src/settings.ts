import { z } from 'zod';
import { countryCodeSchema, currencyCodeSchema } from './common.js';

/**
 * Typed view of the `settings` key/value table. Each key is one row; `value` is the JSON value.
 * Feature agents extend this object with their own `namespace.key` entries (defaults required).
 */
export const settingsSchema = z.object({
  'company.name': z.string().default('Provisia'),
  'company.address': z.string().default(''),
  'company.country': countryCodeSchema.default('NL'),
  'company.vatNumber': z.string().default(''),
  'company.email': z.string().default(''),
  'billing.currency': currencyCodeSchema.default('EUR'),
  'billing.invoiceDaysBeforeDue': z.number().int().min(0).max(90).default(14),
  'billing.paymentTermDays': z.number().int().min(0).max(90).default(14),
  'billing.taxInclusive': z.boolean().default(false),
  'dunning.reminderDays': z.array(z.number().int().min(0)).default([0, 3, 7]),
  'dunning.suspendAfterDays': z.number().int().min(0).default(7),
  'dunning.terminateAfterDays': z.number().int().min(0).default(30),
  'dunning.lateFee': z
    .object({
      type: z.enum(['none', 'fixed', 'percentage']),
      /** Minor units for `fixed`, percent for `percentage`. */
      value: z.number().min(0),
    })
    .default({ type: 'none', value: 0 }),
  'mail.fromName': z.string().default('Provisia'),
  'mail.fromAddress': z.string().default('noreply@example.com'),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const settingKeySchema = z.enum(
  Object.keys(settingsSchema.shape) as [SettingKey, ...SettingKey[]],
);

/** Parses rows from the settings table into the typed object, applying defaults for missing keys. */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): Settings {
  const raw: Record<string, unknown> = {};
  for (const row of rows) raw[row.key] = row.value;
  return settingsSchema.parse(raw);
}

export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

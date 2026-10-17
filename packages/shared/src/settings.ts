import { z } from 'zod';
import { countryCodeSchema, currencyCodeSchema } from './common.js';

/**
 * Typed settings registry. Settings are stored as one row per flat key (`group.field`) in the `settings`
 * table; this file is the single source of truth for groups, fields, defaults and which fields are secrets.
 *
 *  - API: `GET/PUT /api/v1/admin/settings/:group` (secrets masked on read, encrypted at rest).
 *  - Server code: `getSettings(db, 'billing')` from `apps/api/src/lib/settings.ts` (cached), or
 *    `parseSettings(rows)` for the flat view (`s['billing.paymentTermDays']`).
 *  - Feature agents add fields to an existing group (defaults required) or a new group below.
 */
export const settingsGroups = {
  /** Company / branding ("general"). */
  company: z.object({
    name: z.string().max(200).default('Provisia'),
    legalName: z.string().max(200).default(''),
    address: z.string().max(500).default(''),
    country: countryCodeSchema.default('NL'),
    vatNumber: z.string().max(32).default(''),
    email: z.string().max(255).default(''),
    phone: z.string().max(40).default(''),
    website: z.string().max(255).default(''),
    logoUrl: z.string().max(500).default(''),
    iban: z.string().max(40).default(''),
    bic: z.string().max(16).default(''),
    kvk: z.string().max(20).default(''),
  }),
  localization: z.object({
    defaultCurrency: currencyCodeSchema.default('EUR'),
    defaultLocale: z.string().max(10).default('en'),
    availableLocales: z.array(z.string().max(10)).default(['en', 'nl']),
    timezone: z.string().max(64).default('Europe/Amsterdam'),
    dateFormat: z
      .enum(['DD-MM-YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'])
      .default('DD-MM-YYYY'),
  }),
  billing: z.object({
    currency: currencyCodeSchema.default('EUR'),
    invoiceDaysBeforeDue: z.number().int().min(0).max(90).default(14),
    paymentTermDays: z.number().int().min(0).max(90).default(14),
    taxInclusive: z.boolean().default(false),
    invoiceFooter: z.string().default(''),
    invoicePdfLanguage: z.enum(['en', 'nl', 'client']).default('client'),
    /** Credit balance is applied automatically when an invoice is issued. */
    autoApplyCredit: z.boolean().default(true),
  }),
  dunning: z.object({
    reminderDays: z.array(z.number().int().min(0)).default([0, 3, 7]),
    suspendAfterDays: z.number().int().min(0).default(7),
    terminateAfterDays: z.number().int().min(0).default(30),
    lateFee: z
      .object({
        type: z.enum(['none', 'fixed', 'percentage']),
        /** Minor units for `fixed`, percent for `percentage`. */
        value: z.number().min(0),
      })
      .default({ type: 'none', value: 0 }),
    /** Days after the due date at which the (optional) late fee is charged. */
    lateFeeAfterDays: z.number().int().min(0).default(7),
  }),
  tax: z.object({
    /** Validate EU VAT numbers against VIES and apply reverse charge for valid B2B customers. */
    viesValidation: z.boolean().default(true),
    /** Cache a VIES result for this many days before re-checking. */
    viesCacheDays: z.number().int().min(1).max(365).default(90),
    /** Charge 0% to customers outside the EU (export). */
    zeroRateNonEu: z.boolean().default(true),
    /** Treat prices entered by staff as tax inclusive (mirrors billing.taxInclusive for the UI). */
    taxIdLabel: z.string().max(40).default('VAT'),
  }),
  mail: z.object({
    fromName: z.string().max(100).default('Provisia'),
    fromAddress: z.string().max(255).default('noreply@example.com'),
    replyTo: z.string().max(255).default(''),
    /** `env` uses `SMTP_URL` from the environment; `smtp` uses the fields below. */
    transport: z.enum(['env', 'smtp']).default('env'),
    smtpHost: z.string().max(255).default(''),
    smtpPort: z.number().int().min(1).max(65535).default(587),
    smtpSecurity: z.enum(['none', 'starttls', 'tls']).default('starttls'),
    smtpUser: z.string().max(255).default(''),
    /** Secret: encrypted at rest, masked on read. */
    smtpPassword: z.string().max(500).default(''),
    /** Also send a copy of every client email to this address. */
    bccAddress: z.string().max(255).default(''),
    /** Optional DKIM signing (support agent): all three must be set to sign. */
    dkimDomain: z.string().max(255).default(''),
    dkimSelector: z.string().max(100).default(''),
    /** Secret: PEM private key, encrypted at rest, masked on read. */
    dkimPrivateKey: z.string().max(10_000).default(''),
  }),
  /** Helpdesk behaviour (support agent). Departments can override the first two. */
  support: z.object({
    /** Close `answered` tickets with no client reply after N days; 0 disables. */
    autoCloseDays: z.number().int().min(0).max(365).default(7),
    /** Email `escalationEmail` when a client message waits longer than N hours; 0 disables. */
    escalationHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 30)
      .default(24),
    escalationEmail: z.string().max(255).default(''),
    /** Inbound mail from unknown addresses: open a guest ticket or auto-reply with a rejection. */
    unknownSenderPolicy: z.enum(['guest', 'reject']).default('guest'),
    /** Staff address notified of new tickets / client replies when a ticket has no assignee. */
    notifyEmail: z.string().max(255).default(''),
    /** Portal clients may attach files to tickets. */
    allowClientAttachments: z.boolean().default(true),
    /**
     * Treat inbound mail from a staff address as a staff reply. Only honoured when the mailbox's MTA
     * recorded a passing SPF/DKIM/DMARC result; off by default because From headers are forgeable.
     */
    staffRepliesByEmail: z.boolean().default(false),
  }),
  security: z.object({
    allowRegistration: z.boolean().default(true),
    requireEmailVerification: z.boolean().default(false),
    require2faForStaff: z.boolean().default(false),
    /** Failed logins per account inside the window before the account is locked. */
    lockoutAccountAttempts: z.number().int().min(1).max(100).default(5),
    /** Failed logins per IP inside the window before the IP is blocked. */
    lockoutIpAttempts: z.number().int().min(1).max(1000).default(20),
    lockoutWindowMinutes: z.number().int().min(1).max(1440).default(15),
    lockoutDurationMinutes: z.number().int().min(1).max(1440).default(15),
    passwordResetTtlMinutes: z.number().int().min(5).max(1440).default(60),
    /** Server-side lifetime of a session created without "remember me" (hours). */
    sessionTtlHours: z.number().int().min(1).max(720).default(24),
    /** Login URL shown to clients; staff can be told to use a separate hostname. */
    adminIpAllowlist: z.array(z.string().max(64)).default([]),
  }),
  automation: z.object({
    summaryEmailEnabled: z.boolean().default(true),
    /** Recipients of the daily automation summary; empty = every active admin. */
    summaryRecipients: z.array(z.string().max(255)).default([]),
    summaryHourUtc: z.number().int().min(0).max(23).default(6),
    jobsLogRetentionDays: z.number().int().min(1).max(3650).default(30),
    activityLogRetentionDays: z.number().int().min(30).max(3650).default(730),
    tempFileMaxAgeHours: z.number().int().min(1).max(720).default(24),
    /** Keep failed jobs in the dead-letter list for this many days. */
    deadLetterRetentionDays: z.number().int().min(1).max(365).default(30),
  }),
  storage: z.object({
    driver: z.enum(['local']).default('local'),
    /** Root directory for uploads (ticket attachments, invoice PDFs), relative to the process cwd or absolute. */
    localPath: z.string().max(500).default('storage'),
    /** Temp directory cleaned by the maintenance job. */
    tempPath: z.string().max(500).default('storage/tmp'),
    maxUploadMb: z.number().int().min(1).max(500).default(10),
    allowedExtensions: z
      .array(z.string().max(16))
      .default([
        'pdf',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'txt',
        'log',
        'zip',
        'csv',
        'doc',
        'docx',
        'xls',
        'xlsx',
      ]),
  }),
} as const;

export type SettingsGroups = typeof settingsGroups;
export type SettingsGroupName = keyof SettingsGroups;
export const SETTINGS_GROUP_NAMES = Object.keys(settingsGroups) as SettingsGroupName[];
export const settingsGroupNameSchema = z.enum(
  SETTINGS_GROUP_NAMES as [SettingsGroupName, ...SettingsGroupName[]],
);
export type SettingsGroup<G extends SettingsGroupName> = z.infer<SettingsGroups[G]>;

/** Flat keys whose values are secrets: stored encrypted (`enc:v1:...`), returned masked. */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  'mail.smtpPassword',
  'mail.dkimPrivateKey',
]);
/** Value returned in place of a secret; sending it back on PUT keeps the stored value. */
export const SECRET_MASK = '••••••••';

type Prefixed<P extends string, T> = { [K in keyof T & string as `${P}.${K}`]: T[K] };
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/** Flat view: `{ 'billing.paymentTermDays': number, ... }`. */
export type Settings = UnionToIntersection<
  { [G in SettingsGroupName]: Prefixed<G, SettingsGroup<G>> }[SettingsGroupName]
>;
export type SettingKey = keyof Settings & string;

const flatShape: Record<string, z.ZodType> = {};
for (const [group, schema] of Object.entries(settingsGroups)) {
  for (const [field, fieldSchema] of Object.entries(schema.shape)) {
    flatShape[`${group}.${field}`] = fieldSchema as z.ZodType;
  }
}

/** Flat zod object over every `group.field` key (all fields have defaults). */
export const settingsSchema = z.object(flatShape) as unknown as z.ZodType<Settings> & {
  shape: Record<SettingKey, z.ZodType>;
};
export const SETTING_KEYS = Object.keys(flatShape) as SettingKey[];
export const settingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/** Parses rows from the settings table into the flat typed object, applying defaults for missing keys. */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): Settings {
  const raw: Record<string, unknown> = {};
  for (const row of rows) if (row.key in flatShape) raw[row.key] = row.value;
  return settingsSchema.parse(raw);
}

/** Parses the rows of one group (`group.field` keys) into the group's object. */
export function parseSettingsGroup<G extends SettingsGroupName>(
  group: G,
  rows: Array<{ key: string; value: unknown }>,
): SettingsGroup<G> {
  const prefix = `${group}.`;
  const raw: Record<string, unknown> = {};
  for (const row of rows)
    if (row.key.startsWith(prefix)) raw[row.key.slice(prefix.length)] = row.value;
  return settingsGroups[group].parse(raw) as SettingsGroup<G>;
}

export const updateSettingsSchema = z.object(flatShape).partial() as unknown as z.ZodType<
  Partial<Settings>
>;
export type UpdateSettings = Partial<Settings>;

/** Partial update body for `PUT /admin/settings/:group`. */
export function updateSettingsGroupSchema<G extends SettingsGroupName>(group: G) {
  return settingsGroups[group].partial();
}

/** Settings exposed without authentication (`GET /api/v1/public/settings`): branding + locale. */
export const publicSettingsSchema = z.object({
  companyName: z.string(),
  logoUrl: z.string(),
  website: z.string(),
  supportEmail: z.string(),
  defaultLocale: z.string(),
  availableLocales: z.array(z.string()),
  defaultCurrency: z.string(),
  timezone: z.string(),
  dateFormat: z.string(),
  allowRegistration: z.boolean(),
  requireEmailVerification: z.boolean(),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

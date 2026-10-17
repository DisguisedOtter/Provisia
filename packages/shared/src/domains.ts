import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  emailSchema,
  isoDateSchema,
  minorUnitsSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

/** See apps/api/src/modules/domains/README.md for the state machine. */
export const domainStatusSchema = z.enum([
  'pending',
  'pending_registration',
  'pending_transfer',
  'active',
  'expired',
  'redemption',
  'cancelled',
  'transferred_away',
]);
export type DomainStatus = z.infer<typeof domainStatusSchema>;

/** Allowed manual (admin) status transitions; worker transitions are documented in the README. */
export const DOMAIN_STATUS_TRANSITIONS: Record<DomainStatus, DomainStatus[]> = {
  pending: ['pending_registration', 'pending_transfer', 'active', 'cancelled'],
  pending_registration: ['active', 'pending', 'cancelled'],
  pending_transfer: ['active', 'pending', 'cancelled'],
  active: ['expired', 'transferred_away', 'cancelled', 'pending_transfer'],
  expired: ['active', 'redemption', 'cancelled'],
  redemption: ['active', 'cancelled'],
  cancelled: ['pending', 'active'],
  transferred_away: ['active'],
};

/** Days before expiry at which the worker emails the client (`domains:expiry-notices`). */
export const DOMAIN_EXPIRY_NOTICE_DAYS = [60, 30, 7, 1] as const;
/** Days before expiry at which `domains:auto-renew` creates the renewal invoice item. */
export const DOMAIN_AUTO_RENEW_DAYS_BEFORE = 14;

// ---------------------------------------------------------------------------------------------
// Names, TLDs
// ---------------------------------------------------------------------------------------------

export const domainNameSchema = z
  .string()
  .min(3)
  .max(255)
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/, 'invalid domain name');

/** Without leading dot, lowercase: `nl`, `co.uk`. */
export const tldNameSchema = z
  .string()
  .min(2)
  .max(63)
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^\.+/, ''))
  .pipe(z.string().regex(/^[a-z0-9-]{2,63}(\.[a-z0-9-]{2,63})*$/, 'invalid tld'));

/** Second-level label (the part the customer types): `example`. */
export const domainLabelSchema = z
  .string()
  .min(1)
  .max(63)
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'invalid domain label');

/**
 * Splits `example.co.uk` into `{ sld: 'example', tld: 'co.uk' }` given the list of known TLDs
 * (longest match wins). Falls back to the last label when nothing matches.
 */
export function splitDomainName(
  name: string,
  knownTlds: readonly string[] = [],
): { sld: string; tld: string } {
  const lower = name.toLowerCase();
  const sorted = [...knownTlds].sort((a, b) => b.length - a.length);
  for (const tld of sorted) {
    if (lower.endsWith(`.${tld}`)) return { sld: lower.slice(0, -(tld.length + 1)), tld };
  }
  const i = lower.indexOf('.');
  return i === -1 ? { sld: lower, tld: '' } : { sld: lower.slice(0, i), tld: lower.slice(i + 1) };
}

export const tldAdditionalFieldSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});
export type TldAdditionalField = z.infer<typeof tldAdditionalFieldSchema>;

export const tldPriceSchema = z.object({
  id: uuidSchema,
  tldId: uuidSchema,
  years: z.number().int().min(1).max(10),
  currency: currencyCodeSchema,
  register: minorUnitsSchema,
  renew: minorUnitsSchema,
  transfer: minorUnitsSchema,
  costRegister: minorUnitsSchema.nullable(),
  costRenew: minorUnitsSchema.nullable(),
  costTransfer: minorUnitsSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TldPriceRow = z.infer<typeof tldPriceSchema>;

export const tldSchema = z.object({
  id: uuidSchema,
  tld: z.string(),
  registrarModule: z.string().nullable(),
  enabled: z.boolean(),
  featured: z.boolean(),
  currency: currencyCodeSchema,
  minYears: z.number().int(),
  maxYears: z.number().int(),
  eppRequired: z.boolean(),
  idProtectionSupported: z.boolean(),
  dnsManagementSupported: z.boolean(),
  gracePeriodDays: z.number().int(),
  redemptionPeriodDays: z.number().int(),
  redemptionFee: minorUnitsSchema,
  additionalFields: z.array(tldAdditionalFieldSchema),
  sortOrder: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Tld = z.infer<typeof tldSchema>;

export const tldWithPricesSchema = tldSchema.extend({ prices: z.array(tldPriceSchema) });
export type TldWithPrices = z.infer<typeof tldWithPricesSchema>;

export const tldPriceInputSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
  currency: currencyCodeSchema.default('EUR'),
  register: minorUnitsSchema.min(0),
  renew: minorUnitsSchema.min(0),
  transfer: minorUnitsSchema.min(0),
});
export type TldPriceInput = z.infer<typeof tldPriceInputSchema>;

export const createTldSchema = z.object({
  tld: tldNameSchema,
  registrarModule: z.string().max(50).nullable().optional(),
  enabled: z.boolean().default(true),
  featured: z.boolean().default(false),
  currency: currencyCodeSchema.default('EUR'),
  minYears: z.number().int().min(1).max(10).default(1),
  maxYears: z.number().int().min(1).max(10).default(10),
  eppRequired: z.boolean().default(true),
  idProtectionSupported: z.boolean().default(false),
  dnsManagementSupported: z.boolean().default(false),
  gracePeriodDays: z.number().int().min(0).max(365).default(0),
  redemptionPeriodDays: z.number().int().min(0).max(365).default(30),
  redemptionFee: minorUnitsSchema.min(0).default(0),
  additionalFields: z.array(tldAdditionalFieldSchema).default([]),
  sortOrder: z.number().int().default(0),
  prices: z.array(tldPriceInputSchema).default([]),
});
export type CreateTld = z.infer<typeof createTldSchema>;

export const updateTldSchema = createTldSchema.omit({ tld: true }).partial();
export type UpdateTld = z.infer<typeof updateTldSchema>;

/** Public, unauthenticated view used by the order form. */
export const publicTldSchema = z.object({
  tld: z.string(),
  featured: z.boolean(),
  currency: currencyCodeSchema,
  minYears: z.number().int(),
  maxYears: z.number().int(),
  eppRequired: z.boolean(),
  idProtectionSupported: z.boolean(),
  additionalFields: z.array(tldAdditionalFieldSchema),
  prices: z.array(tldPriceInputSchema),
});
export type PublicTld = z.infer<typeof publicTldSchema>;

export const importTldPricingSchema = z.object({
  /** Registrar module to import from. */
  registrarModule: z.string().min(1).max(50),
  /** Sell price = cost * (1 + markupPercent/100), rounded half-up to cents. */
  markupPercent: z.number().min(0).max(1000).default(0),
  /** Create catalog rows for TLDs the registrar offers but we do not have yet (disabled by default). */
  createMissing: z.boolean().default(false),
  /** Overwrite existing sell prices (otherwise only cost columns are refreshed). */
  overwriteSellPrices: z.boolean().default(false),
});
export type ImportTldPricing = z.infer<typeof importTldPricingSchema>;

// ---------------------------------------------------------------------------------------------
// Registrar accounts (module config)
// ---------------------------------------------------------------------------------------------

export const registrarAccountSchema = z.object({
  id: uuidSchema,
  module: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /** Config with secret-looking keys masked (`apiKey: "sk_***"`). */
  config: z.record(z.string(), z.unknown()),
  pricingImportedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type RegistrarAccount = z.infer<typeof registrarAccountSchema>;

export const upsertRegistrarAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  /** Validated against the module's configSchema server-side; masked values keep the stored secret. */
  config: z.record(z.string(), z.unknown()),
});
export type UpsertRegistrarAccount = z.infer<typeof upsertRegistrarAccountSchema>;

export const registrarModuleInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  configured: z.boolean(),
  capabilities: z.object({
    contacts: z.boolean(),
    lock: z.boolean(),
    pricing: z.boolean(),
  }),
});
export type RegistrarModuleInfo = z.infer<typeof registrarModuleInfoSchema>;

// ---------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------

export const domainContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  organization: z.string().max(200).optional(),
  email: emailSchema,
  phone: z.string().min(1).max(40),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  state: z.string().max(100).optional(),
  country: countryCodeSchema,
});
export type DomainContact = z.infer<typeof domainContactSchema>;

export const domainContactsSchema = z.object({
  registrant: domainContactSchema,
  admin: domainContactSchema.optional(),
  tech: domainContactSchema.optional(),
  billing: domainContactSchema.optional(),
});
export type DomainContacts = z.infer<typeof domainContactsSchema>;

/** Saved contact handle (`domain_contacts` row). */
export const domainContactHandleSchema = domainContactSchema.extend({
  id: uuidSchema,
  clientId: uuidSchema,
  label: z.string(),
  isDefault: z.boolean(),
  organization: z.string().nullable(),
  address2: z.string().nullable(),
  state: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DomainContactHandle = z.infer<typeof domainContactHandleSchema>;

export const createDomainContactHandleSchema = domainContactSchema.extend({
  label: z.string().min(1).max(100).default('Default'),
  isDefault: z.boolean().default(false),
  /** Admin only. */
  clientId: uuidSchema.optional(),
});
export type CreateDomainContactHandle = z.infer<typeof createDomainContactHandleSchema>;

export const updateDomainContactHandleSchema = createDomainContactHandleSchema
  .omit({ clientId: true })
  .partial();
export type UpdateDomainContactHandle = z.infer<typeof updateDomainContactHandleSchema>;

// ---------------------------------------------------------------------------------------------
// Domain DTO
// ---------------------------------------------------------------------------------------------

/** EPP code is never included in the DTO; it has its own endpoint. */
export const domainSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  name: domainNameSchema,
  tld: z.string(),
  registrarModule: z.string().nullable(),
  status: domainStatusSchema,
  registrarStatus: z.string().nullable(),
  registrationDate: isoDateSchema.nullable(),
  expiryDate: isoDateSchema.nullable(),
  nextDueDate: isoDateSchema.nullable(),
  registrationPeriod: z.number().int(),
  recurringAmount: minorUnitsSchema,
  currency: currencyCodeSchema,
  nameservers: z.array(z.string()),
  autoRenew: z.boolean(),
  locked: z.boolean(),
  idProtection: z.boolean(),
  contacts: domainContactsSchema.nullable(),
  registrantContactId: uuidSchema.nullable(),
  adminContactId: uuidSchema.nullable(),
  techContactId: uuidSchema.nullable(),
  billingContactId: uuidSchema.nullable(),
  moduleData: z.record(z.string(), z.unknown()),
  lastError: z.string().nullable(),
  lastSyncedAt: timestampSchema.nullable(),
  expiryNoticesSent: z.array(z.number().int()),
  autoRenewInvoicedAt: timestampSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Domain = z.infer<typeof domainSchema>;

/** Portal view: hides registrar internals. */
export const portalDomainSchema = domainSchema.omit({
  moduleData: true,
  lastError: true,
  registrarStatus: true,
  notes: true,
});
export type PortalDomain = z.infer<typeof portalDomainSchema>;

export const nameserversSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .max(255)
      .regex(/^([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/, 'invalid hostname'),
  )
  .min(0)
  .max(13);

/** Client-editable fields. Every change that touches the registrar is pushed by `domains:sync`. */
export const updateDomainSchema = z.object({
  nameservers: nameserversSchema.optional(),
  autoRenew: z.boolean().optional(),
  locked: z.boolean().optional(),
  idProtection: z.boolean().optional(),
  contacts: domainContactsSchema.nullable().optional(),
  registrantContactId: uuidSchema.nullable().optional(),
  adminContactId: uuidSchema.nullable().optional(),
  techContactId: uuidSchema.nullable().optional(),
  billingContactId: uuidSchema.nullable().optional(),
});
export type UpdateDomain = z.infer<typeof updateDomainSchema>;

/** Admin-only extras on top of `updateDomainSchema`. */
export const adminUpdateDomainSchema = updateDomainSchema.extend({
  status: domainStatusSchema.optional(),
  registrarModule: z.string().max(50).nullable().optional(),
  registrationDate: isoDateSchema.nullable().optional(),
  expiryDate: isoDateSchema.nullable().optional(),
  nextDueDate: isoDateSchema.nullable().optional(),
  registrationPeriod: z.number().int().min(1).max(10).optional(),
  recurringAmount: minorUnitsSchema.min(0).optional(),
  notes: z.string().max(5000).nullable().optional(),
  /** Skip the transition check (e.g. when fixing data by hand). */
  force: z.boolean().default(false),
});
export type AdminUpdateDomain = z.infer<typeof adminUpdateDomainSchema>;

export const domainListQuerySchema = z.object({
  clientId: uuidSchema.optional(),
  status: domainStatusSchema.optional(),
  tld: z.string().optional(),
  registrarModule: z.string().optional(),
  search: z.string().max(255).optional(),
  expiringBefore: isoDateSchema.optional(),
});
export type DomainListQuery = z.infer<typeof domainListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------------------------

export const availabilityQuerySchema = z
  .object({
    /** Full name (`example.nl`) ... */
    domain: domainNameSchema.optional(),
    /** ... or a label plus TLDs; defaults to all enabled TLDs (featured first, max `limit`). */
    sld: domainLabelSchema.optional(),
    tlds: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
      .optional(),
    /** Also return suggestions for other configured TLDs when a full `domain` is given. */
    suggestions: z.coerce.boolean().default(true),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .refine((v) => v.domain || v.sld, { message: 'domain or sld is required' });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilityResultSchema = z.object({
  domain: z.string(),
  tld: z.string(),
  /** `available` | `taken` | `unknown` (registrar error / unsupported TLD) */
  status: z.enum(['available', 'taken', 'unknown']),
  available: z.boolean(),
  premium: z.boolean(),
  /** Price for the minimum registration period, from the TLD catalog or the registrar (premium). */
  price: z
    .object({ amount: minorUnitsSchema, currency: currencyCodeSchema, years: z.number().int() })
    .nullable(),
  reason: z.string().optional(),
});
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;

export const availabilityResponseSchema = z.object({
  data: z.object({
    /** The exact name queried (null when only `sld` was given). */
    requested: availabilityResultSchema.nullable(),
    suggestions: z.array(availabilityResultSchema),
    /** Seconds the result may be cached client-side. */
    ttl: z.number().int(),
  }),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

const domainActionBase = z.object({
  domain: domainNameSchema,
  years: z.number().int().min(1).max(10).default(1),
  nameservers: nameserversSchema.optional(),
  /** Either a saved handle ... */
  registrantContactId: uuidSchema.optional(),
  /** ... or inline contacts (admin may also pass both; inline wins). */
  contacts: domainContactsSchema.optional(),
  idProtection: z.boolean().default(false),
  autoRenew: z.boolean().default(true),
  additionalFields: z.record(z.string(), z.string()).default({}),
  /** Admin only; portal derives it from the session. */
  clientId: uuidSchema.optional(),
  /** Override the TLD's registrar (admin only). */
  registrarModule: z.string().max(50).optional(),
});

export const registerDomainRequestSchema = domainActionBase;
export type RegisterDomainRequest = z.infer<typeof registerDomainRequestSchema>;

export const transferDomainRequestSchema = domainActionBase.extend({
  eppCode: z.string().min(1).max(255),
});
export type TransferDomainRequest = z.infer<typeof transferDomainRequestSchema>;

export const renewDomainRequestSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
});
export type RenewDomainRequest = z.infer<typeof renewDomainRequestSchema>;

/** Response of register/transfer/renew: the domain row plus the enqueued job id. */
export const domainActionResponseSchema = z.object({
  data: domainSchema,
  job: z.object({ queue: z.literal('domains'), name: z.string(), id: z.string() }),
});
export type DomainActionResponse = z.infer<typeof domainActionResponseSchema>;

export const eppCodeResponseSchema = z.object({
  data: z.object({
    domain: z.string(),
    /** Null when the code has to be fetched from the registrar first (job enqueued). */
    eppCode: z.string().nullable(),
    fetchedAt: timestampSchema.nullable(),
    job: z.object({ id: z.string() }).nullable(),
  }),
});
export type EppCodeResponse = z.infer<typeof eppCodeResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Sync log & alerts
// ---------------------------------------------------------------------------------------------

export const domainSyncLogSchema = z.object({
  id: uuidSchema,
  domainId: uuidSchema.nullable(),
  job: z.string(),
  status: z.enum(['ok', 'failed', 'skipped']),
  transition: z.string().nullable(),
  message: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestampSchema,
});
export type DomainSyncLogEntry = z.infer<typeof domainSyncLogSchema>;

export const domainAlertSchema = z.object({
  id: uuidSchema,
  domainId: uuidSchema.nullable(),
  severity: z.enum(['info', 'warning', 'error']),
  kind: z.string(),
  title: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  acknowledgedAt: timestampSchema.nullable(),
  acknowledgedBy: uuidSchema.nullable(),
  createdAt: timestampSchema,
});
export type DomainAlert = z.infer<typeof domainAlertSchema>;

// ---------------------------------------------------------------------------------------------
// Order integration (see apps/api/src/modules/domains/README.md "Ordering")
// ---------------------------------------------------------------------------------------------

/** What the orders module passes to `createDomainOrderItem()`. */
export const domainOrderItemInputSchema = z.object({
  type: z.enum(['domain_register', 'domain_transfer']),
  domain: domainNameSchema,
  years: z.number().int().min(1).max(10).default(1),
  eppCode: z.string().max(255).optional(),
  nameservers: nameserversSchema.optional(),
  registrantContactId: uuidSchema.optional(),
  contacts: domainContactsSchema.optional(),
  idProtection: z.boolean().default(false),
  autoRenew: z.boolean().default(true),
  additionalFields: z.record(z.string(), z.string()).default({}),
});
export type DomainOrderItemInput = z.infer<typeof domainOrderItemInputSchema>;
/** What callers pass in (defaults optional). */
export type DomainOrderItemInputRaw = z.input<typeof domainOrderItemInputSchema>;

/** Priced, validated line the orders module can store as an `order_items` row. */
export const domainOrderItemSchema = z.object({
  type: z.enum(['domain_register', 'domain_transfer']),
  domainName: z.string(),
  tld: z.string(),
  registrarModule: z.string().nullable(),
  /** Years. */
  quantity: z.number().int(),
  billingCycle: z.enum(['annually', 'biennially', 'triennially', 'onetime']),
  currency: currencyCodeSchema,
  /** Total for the whole period (minor units, excl. tax). */
  amount: minorUnitsSchema,
  setupFee: minorUnitsSchema,
  /** Price per year used for the recurring amount after the first period. */
  renewAmountPerYear: minorUnitsSchema,
  description: z.string(),
  /** Everything needed to call register/transfer after payment; stored in `order_items.config`. */
  config: z.object({
    years: z.number().int(),
    eppCode: z.string().optional(),
    nameservers: z.array(z.string()).optional(),
    registrantContactId: uuidSchema.optional(),
    contacts: domainContactsSchema.optional(),
    idProtection: z.boolean(),
    autoRenew: z.boolean(),
    additionalFields: z.record(z.string(), z.string()),
  }),
});
export type DomainOrderItem = z.infer<typeof domainOrderItemSchema>;

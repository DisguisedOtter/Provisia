import { z } from 'zod';
import { countryCodeSchema, emailSchema, timestampSchema, uuidSchema } from './common.js';
import { userSchema } from './users.js';

// ---------------------------------------------------------------------------------------------
// Permissions (RBAC). Staff users get the union of their roles' permission strings; `admin` users
// implicitly hold `*`. API keys carry scopes in the same format, intersected with the user's set.
// ---------------------------------------------------------------------------------------------

export const PERMISSION_AREAS = [
  'clients',
  'services',
  'domains',
  'products',
  'servers',
  'invoices',
  'transactions',
  'orders',
  'tickets',
  'users',
  'roles',
  'settings',
  'activity',
  'automation',
  'modules',
  'reports',
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

/** Every concrete permission string the API checks with `requirePermission()`. */
export const PERMISSIONS = [
  'clients.read',
  'clients.write',
  'clients.impersonate',
  'services.read',
  'services.write',
  'domains.read',
  'domains.write',
  'products.read',
  'products.write',
  'servers.read',
  'servers.write',
  'invoices.read',
  'invoices.write',
  'transactions.read',
  'transactions.write',
  'orders.read',
  'orders.write',
  'tickets.read',
  'tickets.write',
  'users.read',
  'users.manage',
  'roles.manage',
  'settings.read',
  'settings.manage',
  'activity.read',
  'automation.read',
  'automation.manage',
  'modules.read',
  'reports.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** A permission, an area wildcard (`clients.*`) or the global wildcard (`*`). */
export const permissionPatternSchema = z
  .string()
  .regex(/^(\*|[a-z]+\.(\*|[a-z_]+))$/, 'Invalid permission');

/**
 * Pure check used by the API guards and the web UI.
 *  - `*` grants everything, `area.*` grants every permission in the area.
 *  - `area.write` and `area.manage` imply `area.read`.
 */
export function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes('*')) return true;
  const dot = required.indexOf('.');
  const area = dot === -1 ? required : required.slice(0, dot);
  const action = dot === -1 ? '' : required.slice(dot + 1);
  for (const g of granted) {
    if (g === required || g === `${area}.*`) return true;
    if (action === 'read' && (g === `${area}.write` || g === `${area}.manage`)) return true;
  }
  return false;
}

export function hasAllPermissions(granted: readonly string[], required: readonly string[]) {
  return required.every((p) => hasPermission(granted, p));
}

/** Seeded system roles. `Admin` is `*`; the others are editable starting points. */
export const DEFAULT_ROLES: Array<{ name: string; description: string; permissions: string[] }> = [
  { name: 'Admin', description: 'Full access to everything', permissions: ['*'] },
  {
    name: 'Support',
    description: 'Tickets, service and domain management, read-only billing',
    permissions: [
      'clients.read',
      'clients.impersonate',
      'services.read',
      'services.write',
      'domains.read',
      'domains.write',
      'products.read',
      'servers.read',
      'invoices.read',
      'orders.read',
      'tickets.read',
      'tickets.write',
      'activity.read',
      'modules.read',
    ],
  },
  {
    name: 'Billing',
    description: 'Clients, invoices, payments and orders',
    permissions: [
      'clients.read',
      'clients.write',
      'services.read',
      'domains.read',
      'products.read',
      'invoices.read',
      'invoices.write',
      'transactions.read',
      'transactions.write',
      'orders.read',
      'orders.write',
      'tickets.read',
      'reports.read',
      'activity.read',
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Login / session
// ---------------------------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Optional shortcut: when supplied with a valid password, the TOTP step is completed in one call. */
  totpCode: z.string().min(6).max(12).optional(),
  /** Persistent cookie for `SESSION_TTL_DAYS`; otherwise a browser-session cookie valid 1 day. */
  rememberMe: z.boolean().default(false),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const impersonatorSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
});
export type Impersonator = z.infer<typeof impersonatorSchema>;

/** `/auth/me` and the login response: the user plus the client id when role is `client`. */
export const authUserSchema = userSchema.extend({
  clientId: uuidSchema.nullable(),
  /** Effective permissions: `['*']` for admins, the union of role permissions for staff, `[]` for clients. */
  permissions: z.array(z.string()).default([]),
  totpEnabled: z.boolean().default(false),
  /** True when `security.require2faForStaff` is on and this staff user has not enrolled yet. */
  totpEnrollmentRequired: z.boolean().default(false),
  /** Present while an admin is logged in as this (client) user. */
  impersonator: impersonatorSchema.nullable().default(null),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const twoFactorChallengeSchema = z.object({
  challengeToken: z.string(),
  expiresAt: timestampSchema,
});

/** `data` is the user when the login is complete, `null` while the TOTP step is pending. */
export const loginResponseSchema = z.object({
  data: authUserSchema.nullable(),
  twoFactor: twoFactorChallengeSchema.optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const login2faRequestSchema = z.object({
  challengeToken: z.string().min(16).max(200),
  /** 6-digit TOTP or a backup code. */
  code: z.string().min(6).max(12),
});
export type Login2faRequest = z.infer<typeof login2faRequestSchema>;

export const meResponseSchema = z.object({ data: authUserSchema });

export const sessionSchema = z.object({
  id: uuidSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  rememberMe: z.boolean(),
  impersonated: z.boolean(),
  current: z.boolean(),
  lastSeenAt: timestampSchema.nullable(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});
export type Session = z.infer<typeof sessionSchema>;

// ---------------------------------------------------------------------------------------------
// Registration, email verification, password reset
// ---------------------------------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one number');

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyName: z.string().max(200).nullable().optional(),
  vatNumber: z.string().max(32).nullable().optional(),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  state: z.string().max(100).nullable().optional(),
  country: countryCodeSchema,
  phone: z.string().max(40).nullable().optional(),
  language: z.string().max(10).default('en'),
  acceptTerms: z.literal(true, { error: 'You must accept the terms' }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerResponseSchema = z.object({
  data: authUserSchema,
  /** True when the account must verify its email before using the portal. */
  verificationRequired: z.boolean(),
});

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});
export const verifyEmailRequestSchema = z.object({ token: z.string().min(16).max(200) });
export const changeOwnPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangeOwnPasswordRequest = z.infer<typeof changeOwnPasswordRequestSchema>;

/** Accepting a staff invite: set the first password. */
export const acceptInviteRequestSchema = resetPasswordRequestSchema;

// ---------------------------------------------------------------------------------------------
// TOTP 2FA
// ---------------------------------------------------------------------------------------------

export const totpStatusSchema = z.object({
  enabled: z.boolean(),
  confirmedAt: timestampSchema.nullable(),
  backupCodesRemaining: z.number().int(),
  /** Whether the current settings force this user to enroll. */
  required: z.boolean(),
});
export type TotpStatus = z.infer<typeof totpStatusSchema>;

export const totpSetupResponseSchema = z.object({
  data: z.object({
    /** `otpauth://totp/...` for authenticator apps. */
    otpauthUrl: z.string(),
    /** The same, as a PNG data URL. */
    qrDataUrl: z.string(),
    /** Manual-entry secret (base32). */
    secret: z.string(),
  }),
});

export const totpCodeSchema = z.object({ code: z.string().min(6).max(12) });
export const totpConfirmResponseSchema = z.object({
  data: z.object({ backupCodes: z.array(z.string()) }),
});
export const totpDisableRequestSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().min(6).max(12),
});

// ---------------------------------------------------------------------------------------------
// Impersonation ("login as client")
// ---------------------------------------------------------------------------------------------

export const impersonateRequestSchema = z.object({ userId: uuidSchema });

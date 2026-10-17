import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';

/** Locales that ship built-in templates. Clients with another `language` fall back to `en`. */
export const emailLocaleSchema = z.enum(['en', 'nl']);
export type EmailLocale = z.infer<typeof emailLocaleSchema>;
export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en';

/** Every transactional email the system sends. Adding a key here requires a template in @provisia/email. */
export const EMAIL_TEMPLATE_KEYS = [
  'invoice.created',
  'invoice.reminder',
  'invoice.overdue',
  'invoice.paid',
  'invoice.late_fee',
  'service.welcome',
  'service.suspended',
  'service.unsuspended',
  'service.terminated',
  'domain.registered',
  'domain.transfer_initiated',
  'domain.expiring',
  'domain.renewed',
  'ticket.opened',
  'ticket.reply',
  'ticket.reply.staff',
  'ticket.closed',
  'auth.password_reset',
  'auth.welcome',
  'auth.2fa_enabled',
  'order.confirmation',
  'payment.failed',
  'admin.notification',
] as const;
export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/* ------------------------------------------------------------------------------------------------
 * Per-key payloads. Keep them flat and serialisable (they are stored in email_log.payload and go
 * through BullMQ as JSON). Money is pre-formatted by the caller (`formatMoney`) or passed as
 * `{ amount, currency }` and formatted by the `money` helper in templates.
 * ---------------------------------------------------------------------------------------------- */

export interface EmailRecipientInfo {
  firstName: string;
  lastName?: string;
  companyName?: string | null;
}

export interface EmailMoney {
  amount: number;
  currency: string;
}

export interface InvoiceEmailData {
  client: EmailRecipientInfo;
  invoice: {
    id: string;
    number: string;
    issueDate: string;
    dueDate: string;
    total: EmailMoney;
    /** Outstanding amount; equals `total` unless partially paid. */
    balance?: EmailMoney;
    status?: string;
  };
  /** Absolute URL to the invoice in the portal. */
  invoiceUrl: string;
  /** Absolute URL that starts a payment. */
  payUrl?: string;
}

export interface ServiceEmailData {
  client: EmailRecipientInfo;
  service: {
    id: string;
    productName: string;
    domain?: string | null;
    nextDueDate?: string | null;
    status?: string;
  };
  serviceUrl: string;
  reason?: string;
}

export interface ServiceWelcomeEmailData extends ServiceEmailData {
  credentials: {
    panelUrl?: string;
    username?: string;
    /** Plain text, only ever included in the welcome mail. */
    password?: string;
    nameservers?: string[];
    serverIp?: string;
    extra?: Record<string, string>;
  };
}

export interface DomainEmailData {
  client: EmailRecipientInfo;
  domain: {
    id: string;
    name: string;
    expiryDate?: string | null;
    registrationDate?: string | null;
    years?: number;
    nameservers?: string[];
    autoRenew?: boolean;
  };
  domainUrl: string;
  /** Days until expiry for `domain.expiring`. */
  daysLeft?: number;
}

export interface TicketEmailData {
  recipient: EmailRecipientInfo;
  ticket: {
    id: string;
    number: string;
    subject: string;
    status: string;
    priority: string;
    departmentName: string;
  };
  /** Latest message body (plain text) for reply notifications. */
  message?: string;
  authorName?: string;
  ticketUrl: string;
}

export interface AuthEmailData {
  user: EmailRecipientInfo & { email: string };
  /** Absolute URL for reset / login. */
  actionUrl: string;
  /** Human readable expiry for reset links, e.g. `60 minutes`. */
  expiresIn?: string;
  ip?: string;
}

export interface OrderEmailData {
  client: EmailRecipientInfo;
  order: {
    id: string;
    number: string;
    total: EmailMoney;
    items: Array<{ description: string; amount: EmailMoney; cycle?: string }>;
  };
  invoice?: { id: string; number: string; dueDate: string } | null;
  orderUrl: string;
  payUrl?: string;
}

export interface PaymentFailedEmailData {
  client: EmailRecipientInfo;
  invoice: { id: string; number: string; total: EmailMoney };
  gateway: string;
  reason?: string;
  payUrl: string;
}

export interface AdminNotificationEmailData {
  title: string;
  message: string;
  level?: 'info' | 'warning' | 'error';
  /** Absolute admin URL. */
  link?: string;
  details?: Record<string, string | number | boolean | null>;
}

/** Payload type per key — the single source of truth for `sendEmail({ key, data })`. */
export interface EmailTemplateData {
  'invoice.created': InvoiceEmailData;
  'invoice.reminder': InvoiceEmailData & { daysOverdue?: number };
  'invoice.overdue': InvoiceEmailData & { daysOverdue: number; suspendDate?: string };
  'invoice.paid': InvoiceEmailData & { paidAt: string; paymentMethod?: string };
  'invoice.late_fee': InvoiceEmailData & { lateFee: EmailMoney };
  'service.welcome': ServiceWelcomeEmailData;
  'service.suspended': ServiceEmailData;
  'service.unsuspended': ServiceEmailData;
  'service.terminated': ServiceEmailData;
  'domain.registered': DomainEmailData;
  'domain.transfer_initiated': DomainEmailData;
  'domain.expiring': DomainEmailData & { daysLeft: number };
  'domain.renewed': DomainEmailData;
  'ticket.opened': TicketEmailData;
  'ticket.reply': TicketEmailData;
  'ticket.reply.staff': TicketEmailData;
  'ticket.closed': TicketEmailData;
  'auth.password_reset': AuthEmailData;
  'auth.welcome': AuthEmailData;
  'auth.2fa_enabled': AuthEmailData;
  'order.confirmation': OrderEmailData;
  'payment.failed': PaymentFailedEmailData;
  'admin.notification': AdminNotificationEmailData;
}

/** Entity reference stored on `email_log` so mails can be found per invoice / ticket / service. */
export const emailRelatedSchema = z.object({
  type: z.string().max(50),
  id: uuidSchema,
});
export type EmailRelated = z.infer<typeof emailRelatedSchema>;

export const emailAttachmentRefSchema = z.object({
  filename: z.string().min(1).max(255),
  /** Absolute path on the API/worker host (e.g. invoice PDF) ... */
  path: z.string().min(1).optional(),
  /** ... or inline base64 content for small files. */
  contentBase64: z.string().optional(),
  contentType: z.string().max(150).optional(),
});
export type EmailAttachmentRef = z.infer<typeof emailAttachmentRefSchema>;

/**
 * `email:send` job payload. Either a template send (`key` + `data`) or a raw message (`subject` + `html`).
 * Typed overload for templates: `TemplateSendJob<K>`.
 */
export const emailSendJobSchema = z.object({
  key: emailTemplateKeySchema.optional(),
  to: emailSchema,
  toName: z.string().max(200).optional(),
  toUserId: uuidSchema.optional(),
  cc: z.array(emailSchema).max(10).optional(),
  replyTo: emailSchema.optional(),
  locale: z.string().max(10).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  /** Raw message fields; used when `key` is absent. */
  subject: z.string().max(500).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  attachments: z.array(emailAttachmentRefSchema).max(10).optional(),
  related: emailRelatedSchema.optional(),
  /** Department whose SMTP mailbox should be used for the From/envelope (ticket mail). */
  departmentId: uuidSchema.optional(),
  /** Extra headers (threading: In-Reply-To / References). */
  headers: z.record(z.string(), z.string()).optional(),
});
export type EmailSendJob = z.infer<typeof emailSendJobSchema>;

export type TemplateSendJob<K extends EmailTemplateKey = EmailTemplateKey> = Omit<
  EmailSendJob,
  'key' | 'data' | 'subject' | 'html' | 'text'
> & { key: K; data: EmailTemplateData[K] };

/* ------------------------------------------------------------------------------------------------
 * Admin DTOs: templates, log, SMTP settings
 * ---------------------------------------------------------------------------------------------- */

export const emailTemplateSchema = z.object({
  id: uuidSchema.nullable(),
  key: emailTemplateKeySchema,
  locale: z.string(),
  name: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string().nullable(),
  useLayout: z.boolean(),
  enabled: z.boolean(),
  /** False when this is the built-in template (no DB row yet). */
  customized: z.boolean(),
  /** Variable names available to this template (for the editor). */
  variables: z.array(z.string()),
  updatedAt: timestampSchema.nullable(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const upsertEmailTemplateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().max(200_000).nullable().optional(),
  useLayout: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type UpsertEmailTemplate = z.infer<typeof upsertEmailTemplateSchema>;

export const previewEmailTemplateSchema = z.object({
  /** When provided, previews unsaved edits instead of the stored template. */
  subject: z.string().max(500).optional(),
  bodyHtml: z.string().max(200_000).optional(),
  useLayout: z.boolean().optional(),
  /** Overrides for the sample data. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type PreviewEmailTemplate = z.infer<typeof previewEmailTemplateSchema>;

export const renderedEmailSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type RenderedEmail = z.infer<typeof renderedEmailSchema>;

export const testSendEmailSchema = z.object({
  to: emailSchema,
  locale: emailLocaleSchema.default('en'),
});

export const emailStatusSchema = z.enum(['queued', 'sent', 'failed', 'bounced']);
export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const emailLogAttachmentSchema = z.object({
  filename: z.string(),
  size: z.number().int(),
  contentType: z.string().optional(),
});

export const emailLogSchema = z.object({
  id: uuidSchema,
  toEmail: z.string(),
  toUserId: uuidSchema.nullable(),
  cc: z.array(z.string()),
  fromEmail: z.string().nullable(),
  templateKey: z.string().nullable(),
  locale: z.string().nullable(),
  subject: z.string(),
  status: emailStatusSchema,
  error: z.string().nullable(),
  messageId: z.string().nullable(),
  attempts: z.number().int(),
  attachments: z.array(emailLogAttachmentSchema),
  relatedType: z.string().nullable(),
  relatedId: uuidSchema.nullable(),
  sentAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type EmailLogEntry = z.infer<typeof emailLogSchema>;

/** Detail view adds the rendered body. */
export const emailLogDetailSchema = emailLogSchema.extend({
  bodyHtml: z.string().nullable(),
  bodyText: z.string().nullable(),
});
export type EmailLogDetail = z.infer<typeof emailLogDetailSchema>;

export const emailLogQuerySchema = paginationQuerySchema.extend({
  status: emailStatusSchema.optional(),
  templateKey: emailTemplateKeySchema.optional(),
  to: z.string().max(255).optional(),
  relatedType: z.string().max(50).optional(),
  relatedId: uuidSchema.optional(),
  search: z.string().max(200).optional(),
});
export type EmailLogQuery = z.infer<typeof emailLogQuerySchema>;

/** `POST /admin/email/smtp/test`: sends a test message with the SMTP settings from the `mail` settings group. */
export const smtpTestSchema = z.object({ to: emailSchema });

export const smtpTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Set when a test message was sent. */
  messageId: z.string().optional(),
});

/* ------------------------------------------------------------------------------------------------
 * In-app notifications
 * ---------------------------------------------------------------------------------------------- */

export const notificationLevelSchema = z.enum(['info', 'warning', 'error']);
export type NotificationLevel = z.infer<typeof notificationLevelSchema>;

export const notificationSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  level: notificationLevelSchema,
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: uuidSchema.nullable(),
  readAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = paginationQuerySchema.extend({
  unread: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  level: notificationLevelSchema.optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const notifyInputSchema = z.object({
  /** Null/omitted = every admin and staff user sees it. */
  userId: uuidSchema.nullable().optional(),
  level: notificationLevelSchema.default('info'),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  body: z.string().max(5000).nullable().optional(),
  link: z.string().max(500).nullable().optional(),
  entityType: z.string().max(50).nullable().optional(),
  entityId: uuidSchema.nullable().optional(),
  /** Also send `admin.notification` by email to `company.email`. Default false. */
  email: z.boolean().default(false),
});
export type NotifyInput = z.input<typeof notifyInputSchema>;

import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_TEMPLATE_KEYS,
  type EmailLocale,
  type EmailTemplateKey,
} from '@provisia/shared';
import { type BuiltInTemplate, EN_FOOTER, EN_TEMPLATES } from './en.js';
import { NL_FOOTER, NL_TEMPLATES } from './nl.js';

export type { BuiltInTemplate } from './en.js';
export { LAYOUT_HTML } from './layout.js';

const BY_LOCALE: Record<
  EmailLocale,
  { templates: Record<EmailTemplateKey, BuiltInTemplate>; footer: string }
> = {
  en: { templates: EN_TEMPLATES, footer: EN_FOOTER },
  nl: { templates: NL_TEMPLATES, footer: NL_FOOTER },
};

/** `nl-NL` → `nl`; unknown → `en`. */
export function normalizeLocale(locale: string | null | undefined): EmailLocale {
  const short = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return short && short in BY_LOCALE ? (short as EmailLocale) : DEFAULT_EMAIL_LOCALE;
}

export function builtInTemplate(
  key: EmailTemplateKey,
  locale: string | null | undefined,
): BuiltInTemplate {
  return BY_LOCALE[normalizeLocale(locale)].templates[key];
}

export function builtInFooter(locale: string | null | undefined): string {
  return BY_LOCALE[normalizeLocale(locale)].footer;
}

export function isTemplateKey(key: string): key is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/** Top-level variable names available per key (for the admin editor). Derived from the sample data. */
export const TEMPLATE_VARIABLES: Record<EmailTemplateKey, string[]> = {
  'invoice.created': ['client', 'invoice', 'invoiceUrl', 'payUrl', 'company'],
  'invoice.reminder': ['client', 'invoice', 'invoiceUrl', 'payUrl', 'daysOverdue', 'company'],
  'invoice.overdue': [
    'client',
    'invoice',
    'invoiceUrl',
    'payUrl',
    'daysOverdue',
    'suspendDate',
    'company',
  ],
  'invoice.paid': ['client', 'invoice', 'invoiceUrl', 'paidAt', 'paymentMethod', 'company'],
  'invoice.late_fee': ['client', 'invoice', 'invoiceUrl', 'payUrl', 'lateFee', 'company'],
  'service.welcome': ['client', 'service', 'serviceUrl', 'credentials', 'company'],
  'service.suspended': ['client', 'service', 'serviceUrl', 'reason', 'company'],
  'service.unsuspended': ['client', 'service', 'serviceUrl', 'company'],
  'service.terminated': ['client', 'service', 'serviceUrl', 'reason', 'company'],
  'domain.registered': ['client', 'domain', 'domainUrl', 'company'],
  'domain.transfer_initiated': ['client', 'domain', 'domainUrl', 'company'],
  'domain.expiring': ['client', 'domain', 'domainUrl', 'daysLeft', 'company'],
  'domain.renewed': ['client', 'domain', 'domainUrl', 'company'],
  'ticket.opened': ['recipient', 'ticket', 'message', 'authorName', 'ticketUrl', 'company'],
  'ticket.reply': ['recipient', 'ticket', 'message', 'authorName', 'ticketUrl', 'company'],
  'ticket.reply.staff': ['recipient', 'ticket', 'message', 'authorName', 'ticketUrl', 'company'],
  'ticket.closed': ['recipient', 'ticket', 'ticketUrl', 'company'],
  'auth.password_reset': ['user', 'actionUrl', 'expiresIn', 'ip', 'company'],
  'auth.welcome': ['user', 'actionUrl', 'company'],
  'auth.2fa_enabled': ['user', 'actionUrl', 'ip', 'company'],
  'order.confirmation': ['client', 'order', 'invoice', 'orderUrl', 'payUrl', 'company'],
  'payment.failed': ['client', 'invoice', 'gateway', 'reason', 'payUrl', 'company'],
  'admin.notification': ['title', 'message', 'level', 'link', 'details', 'company'],
};

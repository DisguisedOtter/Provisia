import type {
  ClientStatus,
  DomainStatus,
  InvoiceStatus,
  OrderStatus,
  ServiceStatus,
  TicketPriority,
  TicketStatus,
  TransactionType,
} from '@provisia/shared';

/** Tone → Tailwind classes shared by every status badge (light + dark). */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  unpaid: { label: 'Unpaid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'info' },
  collections: { label: 'Collections', tone: 'danger' },
};
export const SERVICE_STATUS: Record<ServiceStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
  terminated: { label: 'Terminated', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const DOMAIN_STATUS: Record<DomainStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  pending_registration: { label: 'Registering', tone: 'info' },
  pending_transfer: { label: 'Pending transfer', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'danger' },
  redemption: { label: 'Redemption', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  transferred_away: { label: 'Transferred away', tone: 'neutral' },
};
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  active: { label: 'Accepted', tone: 'success' },
  fraud: { label: 'Fraud', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'danger' },
  answered: { label: 'Answered', tone: 'success' },
  customer_reply: { label: 'Customer reply', tone: 'warning' },
  on_hold: { label: 'On hold', tone: 'info' },
  closed: { label: 'Closed', tone: 'muted' },
};
export const TICKET_PRIORITY: Record<TicketPriority, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'muted' },
  medium: { label: 'Medium', tone: 'neutral' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' },
};
export const CLIENT_STATUS: Record<ClientStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'muted' },
  closed: { label: 'Closed', tone: 'neutral' },
};
export const TRANSACTION_TYPE: Record<TransactionType, { label: string; tone: Tone }> = {
  payment: { label: 'Payment', tone: 'success' },
  refund: { label: 'Refund', tone: 'warning' },
  credit: { label: 'Credit', tone: 'info' },
};
export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  sent: { label: 'Sent', tone: 'success' },
  bounced: { label: 'Bounced', tone: 'danger' },
  success: { label: 'Success', tone: 'success' },
  ok: { label: 'OK', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'muted' },
};

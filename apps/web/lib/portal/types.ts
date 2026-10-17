/**
 * Portal-side view types. Most DTOs come straight from `@provisia/shared`; the few local shapes
 * below are assumptions about responses the backend agents have not typed yet (see ENDPOINTS.md).
 * When a shared schema appears, replace the local type with an import.
 */
import type {
  BillingCycle,
  Client,
  Invoice,
  PortalDomain,
  Product,
  ProductPrice,
  Service,
  ServiceUsage,
  TicketAttachment,
} from '@provisia/shared';

/* ---------- re-exports from shared (so views import from one place) ---------- */
export type {
  AutoPaySettings,
  AvailabilityResponse,
  AvailabilityResult,
  CartQuote,
  Client,
  ClientContact,
  CreateClientContact,
  EmailLogEntry,
  EppCodeResponse,
  InvoiceWithItems,
  PaymentMethod,
  PaymentStart,
  PortalDomain,
  PortalGateway,
  PowerAction,
  ProductGroup,
  ProductWithPrices,
  ProvisioningLoginUrl,
  PublicTicketDepartment,
  PublicTld,
  RegisterRequest,
  SetupStart,
  TicketDetail,
  TicketListItem,
  TicketReply,
  Transaction,
  VatValidationResult,
} from '@provisia/shared';

export type InvoiceListItem = Invoice;
export type ClientProfile = Client;

/** `GET /portal/services/:id`: the service plus a slim product and module capabilities. */
export type ServiceDetail = Service & {
  product?: Pick<Product, 'id' | 'name' | 'slug' | 'type' | 'module' | 'groupId'> | null;
  capabilities?: {
    loginUrl?: boolean;
    changePassword?: boolean;
    power?: boolean;
    usage?: boolean;
    changePackage?: boolean;
  } | null;
};

/** List rows may carry the product name too. */
export type ServiceListItem = Service & {
  product?: Pick<Product, 'id' | 'name' | 'type' | 'module'> | null;
};

export interface UpgradeOption {
  product: Pick<Product, 'id' | 'name' | 'slug' | 'description' | 'type'>;
  prices: ProductPrice[];
}

/** `POST /portal/services/:id/change-package/preview` (billing proration). */
export interface ProrationPreview {
  currency: string;
  /** Credit for unused time on the current package (positive number, shown as negative). */
  credit: number;
  /** Charge for the new package until the next due date. */
  charge: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  nextDueDate: string | null;
  billingCycle: BillingCycle;
  newRecurringAmount: number;
}

export interface UsagePoint {
  t: string;
  cpu?: number;
  memMb?: number;
  netInMb?: number;
  netOutMb?: number;
}

/**
 * `GET /portal/services/:id/usage`: shared `ServiceUsage` plus VPS extras. Modules that only fill
 * `extra` are handled by `normalizeUsage()`.
 */
export type UsageInfo = ServiceUsage & {
  cpuPercent?: number | null;
  memoryUsedMb?: number | null;
  memoryLimitMb?: number | null;
  powerState?: 'running' | 'stopped' | 'unknown' | null;
  history?: UsagePoint[];
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeUsage(u: UsageInfo): UsageInfo {
  const extra = (u.extra ?? {}) as Record<string, unknown>;
  const state = u.powerState ?? extra.powerState ?? extra.status;
  return {
    ...u,
    cpuPercent: u.cpuPercent ?? num(extra.cpuPercent) ?? num(extra.cpu),
    memoryUsedMb: u.memoryUsedMb ?? num(extra.memoryUsedMb) ?? num(extra.memUsedMb),
    memoryLimitMb: u.memoryLimitMb ?? num(extra.memoryLimitMb) ?? num(extra.memLimitMb),
    powerState:
      state === 'running' || state === 'stopped'
        ? state
        : state
          ? 'unknown'
          : (u.powerState ?? null),
    history: Array.isArray(u.history) ? u.history : [],
  };
}

export type CancellationType = 'immediate' | 'end_of_term';

/** Upload response for ticket attachments (`POST /portal/tickets/attachments`). */
export type UploadedAttachment = Pick<TicketAttachment, 'id' | 'name' | 'size' | 'mimeType'>;

/** Product detail may carry configurable options (not in the shared catalog schema yet). */
export interface ConfigurableOptionChoice {
  id: string;
  label: string;
  /** Extra recurring price per cycle, minor units. Missing cycle = not available. */
  prices?: Partial<Record<BillingCycle, number>>;
}
export interface ConfigurableOption {
  id: string;
  name: string;
  type: 'select' | 'checkbox' | 'quantity' | 'text';
  required?: boolean;
  min?: number;
  max?: number;
  choices?: ConfigurableOptionChoice[];
  /** For quantity/checkbox: price per unit per cycle. */
  prices?: Partial<Record<BillingCycle, number>>;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

/** Domain used as a slim reference in pickers. */
export type DomainRef = Pick<PortalDomain, 'id' | 'name'>;

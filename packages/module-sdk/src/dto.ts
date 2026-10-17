/**
 * DTO types passed to modules. They are the shared API shapes, re-exported under the names
 * used in the plugin contract (ARCHITECTURE.md section 4) so module code depends only on this package.
 */
import type {
  Domain,
  DomainContacts,
  Invoice,
  InvoiceItem,
  Money,
  PaymentMethod,
  Product,
  Server,
  Service,
  Transaction,
} from '@provisia/shared';

export type { DomainContacts as Contacts, Money };

export type InvoiceDTO = Invoice & {
  items: InvoiceItem[];
  /** Client-facing details a gateway needs for the checkout. */
  client: { id: string; email: string; name: string; companyName: string | null; country: string };
};
export type TransactionDTO = Transaction;
export type DomainDTO = Domain;
export type ProductDTO = Product;
export type ServerDTO = Server;
/** Service plus the product it was bought as and its server (if assigned). */
export type ServiceDTO = Service & {
  product: Product;
  server: Server | null;
  /** Plaintext panel password, decrypted by the caller, only for operations that need it. */
  password?: string;
  /** Client details used to create panel accounts. */
  client: { id: string; email: string; name: string; companyName: string | null; country: string };
};

/** Raw inbound HTTP request handed to `PaymentGateway.handleWebhook` for signature verification. */
export interface RawRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Exact bytes as received; required for HMAC verification. */
  rawBody: Buffer;
  /** Parsed JSON body when the content type is JSON, otherwise undefined. */
  body: unknown;
  query: Record<string, string | string[] | undefined>;
}

export type WebhookResult =
  | {
      kind: 'payment';
      /** Gateway transaction id; unique per gateway, used for idempotency. */
      txnId: string;
      invoiceId: string;
      amount: Money;
      fee?: Money;
      /** Gateway event/delivery id when the gateway has one; used for the webhook event log. */
      eventId?: string;
      raw?: Record<string, unknown>;
    }
  | {
      kind: 'refund';
      txnId: string;
      originalTxnId: string;
      amount: Money;
      eventId?: string;
      raw?: Record<string, unknown>;
    }
  | {
      kind: 'failed';
      txnId: string;
      invoiceId?: string;
      reason: string;
      eventId?: string;
      raw?: Record<string, unknown>;
    }
  | {
      /** A saved-payment-method setup (SetupIntent / first mandate payment) finished successfully. */
      kind: 'setup_completed';
      setupId: string;
      clientId: string;
      method: SavedMethodInput;
      eventId?: string;
      raw?: Record<string, unknown>;
    }
  | { kind: 'ignored'; reason: string; eventId?: string };

/** Saved payment method as persisted in `payment_methods`; handed to gateways for off-session charges. */
export type PaymentMethodDTO = PaymentMethod;

/** What a gateway returns when a customer finished saving a method. */
export interface SavedMethodInput {
  /** `card`, `sepa_debit`, `paypal`, `ideal`, ... (gateway vocabulary). */
  type: string;
  gatewayCustomerId: string | null;
  /** Stripe payment_method id, Mollie mandate id, ... */
  gatewayMethodId: string;
  /** Human label: `Visa •••• 4242`, `NL91 ABNA •••• 0417`. */
  label: string;
  expiresAt?: string | null;
  details?: Record<string, unknown>;
}

export interface SetupRequest {
  client: { id: string; email: string; name: string };
  /** Customer id at the gateway from a previously saved method of this client, if any. */
  gatewayCustomerId: string | null;
  returnUrl: string;
}

export interface SetupResult {
  redirectUrl?: string;
  clientSecret?: string;
  /** Gateway id of the setup (SetupIntent / Checkout Session / first payment id). */
  setupId: string;
  gatewayCustomerId?: string | null;
}

export interface ChargeResult {
  txnId: string;
  status: 'succeeded' | 'pending' | 'failed';
  fee?: Money;
  reason?: string;
}

export interface PaymentStatusResult {
  status: 'pending' | 'succeeded' | 'failed' | 'expired';
  /** Final gateway transaction id when it differs from the one created (e.g. PayPal capture vs order). */
  txnId?: string;
  invoiceId?: string;
  amount?: Money;
  fee?: Money;
  reason?: string;
}

/** Result of a browser return handler (gateways that need a server-side capture on return). */
export interface ReturnResult {
  redirectUrl: string;
  result?: WebhookResult;
}

export interface RefundResult {
  refundTxnId: string;
  amount: Money;
  /** `pending` when the gateway confirms asynchronously via webhook. */
  status: 'completed' | 'pending';
}

export interface AvailabilityResult {
  domain: string;
  available: boolean;
  /** Premium domains carry their own price. */
  premium?: boolean;
  price?: Money;
  reason?: string;
}

export interface RegisterRequest {
  domain: string;
  years: number;
  nameservers: string[];
  contacts: DomainContacts;
  idProtection?: boolean;
  /** Registry/TLD specific extra fields (e.g. .nl legal form). */
  additionalFields?: Record<string, string>;
}

export interface TransferRequest extends RegisterRequest {
  eppCode: string;
}

export interface DomainResult {
  /** `completed` for sync registrations, `pending` when the registrar processes asynchronously. */
  status: 'completed' | 'pending';
  expiryDate?: string;
  /** Opaque registrar state to persist in `domains.module_data`. */
  moduleData?: Record<string, unknown>;
  message?: string;
}

export interface DomainInfo {
  status: 'active' | 'expired' | 'pending' | 'pending_transfer' | 'transferred_away' | 'unknown';
  expiryDate: string | null;
  nameservers: string[];
  locked: boolean | null;
  idProtection: boolean | null;
  autoRenew?: boolean | null;
  contacts?: DomainContacts;
}

export interface TldPrice {
  tld: string;
  currency: string;
  /** Minor units per year. */
  register: number;
  renew: number;
  transfer: number;
  minYears: number;
  maxYears: number;
}

export interface ProvisionResult {
  /** Persisted to `services.module_data`. */
  moduleData: Record<string, unknown>;
  username?: string;
  /** Plaintext; the caller encrypts it before persisting. */
  password?: string;
  /** Main IP / hostname of the created account or VM. */
  ipAddress?: string;
  message?: string;
}

/** An option discovered on a server (cPanel package, Plesk service plan, Proxmox template/node/storage, ...). */
export interface RemoteOption {
  id: string;
  name: string;
  /** Module specific details shown in the admin UI (e.g. disk quota, node). */
  extra?: Record<string, string | number | boolean | null>;
}

/** VPS power actions; `suspend`/`unsuspend`/`terminate` remain separate lifecycle calls. */
export type PowerAction = 'start' | 'stop' | 'shutdown' | 'reboot';

export interface UsageInfo {
  diskUsedMb?: number;
  diskLimitMb?: number;
  bandwidthUsedMb?: number;
  bandwidthLimitMb?: number;
  /** Module specific extras (CPU, RAM, inodes, ...). */
  extra?: Record<string, number | string>;
}

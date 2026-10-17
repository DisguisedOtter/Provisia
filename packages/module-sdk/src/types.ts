import type { ZodObject } from 'zod';
import type { GatewayContext, ModuleContext } from './context.js';
import type {
  AvailabilityResult,
  ChargeResult,
  Contacts,
  DomainDTO,
  DomainInfo,
  DomainResult,
  InvoiceDTO,
  Money,
  PaymentMethodDTO,
  PaymentStatusResult,
  PowerAction,
  ProductDTO,
  ProvisionResult,
  RawRequest,
  RefundResult,
  RegisterRequest,
  RemoteOption,
  ReturnResult,
  ServerDTO,
  ServiceDTO,
  SetupRequest,
  SetupResult,
  TldPrice,
  TransactionDTO,
  TransferRequest,
  UsageInfo,
  WebhookResult,
} from './dto.js';

// The plugin contract from ARCHITECTURE.md section 4. Add, never modify.

export interface ModuleMeta {
  id: string;
  name: string;
  version: string;
  configSchema: ZodObject;
}

export interface PaymentGateway extends ModuleMeta {
  capabilities: { refunds: boolean; savedMethods: boolean; recurring: boolean };
  createPayment(
    ctx: GatewayContext,
    invoice: InvoiceDTO,
  ): Promise<{ redirectUrl?: string; clientSecret?: string; txnId: string }>;
  /** Must be idempotent: the same event delivered twice yields the same result. */
  handleWebhook(ctx: GatewayContext, req: RawRequest): Promise<WebhookResult>;
  refund?(ctx: GatewayContext, txn: TransactionDTO, amount: Money): Promise<RefundResult>;
  // Optional members added by the payments module (ARCHITECTURE section 4: add, never modify).
  /** Validates the configured credentials with a cheap read-only call. */
  testCredentials?(ctx: GatewayContext): Promise<{ ok: boolean; message?: string }>;
  /** Polls the gateway for a payment created earlier (reconciliation of stuck pending payments). */
  getPaymentStatus?(ctx: GatewayContext, txnId: string): Promise<PaymentStatusResult>;
  /** Starts saving a payment method for later off-session charges (SetupIntent / first mandate payment). */
  createSetup?(ctx: GatewayContext, req: SetupRequest): Promise<SetupResult>;
  /** Charges a saved method off-session (auto-pay). */
  chargeSavedMethod?(
    ctx: GatewayContext,
    invoice: InvoiceDTO,
    method: PaymentMethodDTO,
  ): Promise<ChargeResult>;
  /** Detaches / revokes a saved method at the gateway. */
  removeSavedMethod?(ctx: GatewayContext, method: PaymentMethodDTO): Promise<void>;
  /** Browser return handler for gateways that must capture server-side on return (PayPal). */
  handleReturn?(ctx: GatewayContext, req: RawRequest): Promise<ReturnResult>;
}

export interface Registrar extends ModuleMeta {
  checkAvailability(ctx: ModuleContext, domains: string[]): Promise<AvailabilityResult[]>;
  register(ctx: ModuleContext, req: RegisterRequest): Promise<DomainResult>;
  transfer(ctx: ModuleContext, req: TransferRequest): Promise<DomainResult>;
  renew(ctx: ModuleContext, domain: DomainDTO, years: number): Promise<DomainResult>;
  getInfo(ctx: ModuleContext, domain: DomainDTO): Promise<DomainInfo>;
  setNameservers(ctx: ModuleContext, domain: DomainDTO, ns: string[]): Promise<void>;
  getEppCode(ctx: ModuleContext, domain: DomainDTO): Promise<string>;
  setContacts?(ctx: ModuleContext, domain: DomainDTO, contacts: Contacts): Promise<void>;
  setLock?(ctx: ModuleContext, domain: DomainDTO, locked: boolean): Promise<void>;
  getTldPricing?(ctx: ModuleContext): Promise<TldPrice[]>;
}

export interface Provisioner extends ModuleMeta {
  /** Returns module_data to persist. */
  create(ctx: ModuleContext, service: ServiceDTO): Promise<ProvisionResult>;
  suspend(ctx: ModuleContext, service: ServiceDTO, reason?: string): Promise<void>;
  unsuspend(ctx: ModuleContext, service: ServiceDTO): Promise<void>;
  terminate(ctx: ModuleContext, service: ServiceDTO): Promise<void>;
  changePackage?(ctx: ModuleContext, service: ServiceDTO, newProduct: ProductDTO): Promise<void>;
  changePassword?(ctx: ModuleContext, service: ServiceDTO, password: string): Promise<void>;
  getUsage?(ctx: ModuleContext, service: ServiceDTO): Promise<UsageInfo>;
  /** SSO into the panel. */
  loginUrl?(ctx: ModuleContext, service: ServiceDTO): Promise<string>;
  testConnection(ctx: ModuleContext, server: ServerDTO): Promise<{ ok: boolean; message?: string }>;
  /** Optional: validates server credentials on create/update (added by the provisioning agent). */
  credentialsSchema?: ZodObject;
  /** Optional: discover packages / plans / templates for product configuration dropdowns. */
  listRemoteOptions?(ctx: ModuleContext, server: ServerDTO, kind: string): Promise<RemoteOption[]>;
  /** Optional: VPS power control (Proxmox). */
  power?(ctx: ModuleContext, service: ServiceDTO, action: PowerAction): Promise<void>;
}

export type ModuleKind = 'gateway' | 'registrar' | 'provisioner';

export type ModuleByKind = {
  gateway: PaymentGateway;
  registrar: Registrar;
  provisioner: Provisioner;
};

export type AnyModule = PaymentGateway | Registrar | Provisioner;

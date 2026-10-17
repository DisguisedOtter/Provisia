import type { ZodObject } from 'zod';
import type { GatewayContext, ModuleContext } from './context.js';
import type {
  AvailabilityResult,
  Contacts,
  DomainDTO,
  DomainInfo,
  DomainResult,
  InvoiceDTO,
  Money,
  ProductDTO,
  ProvisionResult,
  RawRequest,
  RefundResult,
  RegisterRequest,
  ServerDTO,
  ServiceDTO,
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
}

export type ModuleKind = 'gateway' | 'registrar' | 'provisioner';

export type ModuleByKind = {
  gateway: PaymentGateway;
  registrar: Registrar;
  provisioner: Provisioner;
};

export type AnyModule = PaymentGateway | Registrar | Provisioner;

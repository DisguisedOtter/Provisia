/**
 * Typed client calls for the portal and public API. Paths follow ARCHITECTURE.md section 6 and
 * the shared DTOs; every endpoint assumed here is listed in ENDPOINTS.md for reconciliation.
 * Uses the shared `http` helper from `@/lib/api` (session cookie, envelope unwrapping, ApiError).
 */
import type {
  AuthUser,
  AutoPaySettings,
  AvailabilityResponse,
  CartItem,
  CartQuote,
  Client,
  ClientContact,
  CreateClientContact,
  EmailLogEntry,
  EppCodeResponse,
  InvoiceWithItems,
  ModuleExtraDescriptor,
  Order,
  OrderWithItems,
  Paginated,
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
  QueuedJob,
  RegisterRequest,
  SetupStart,
  Ticket,
  TicketDetail,
  TicketListItem,
  TicketReply,
  Transaction,
  UpdateClientContact,
  UpdateDomain,
  VatValidationResult,
} from '@provisia/shared';
import { API_URL, ApiError, type Data, http } from '@/lib/api';
import type {
  Announcement,
  CancellationType,
  ConfigurableOption,
  InvoiceListItem,
  ProrationPreview,
  ServiceDetail,
  ServiceListItem,
  UpgradeOption,
  UploadedAttachment,
  UsageInfo,
} from './types';

type ListQuery = Record<string, string | number | boolean | undefined>;

/** multipart/form-data POST (attachment upload). Same cookie + envelope semantics as `http`. */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: unknown };
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'http_error',
      json?.error?.message ?? res.statusText,
      json?.error?.details,
    );
  }
  return json as T;
}

/** `{ data, job }` for action endpoints that enqueue a worker job (domains). */
type ActionResponse<T> = { data: T; job?: { id: string; queue?: string; name?: string } | null };

export const portalApi = {
  account: {
    get: () => http.get<Data<Client>>('/portal/account'),
    update: (body: Partial<Client>) => http.patch<Data<Client>>('/portal/account', body),
    validateVat: () => http.post<Data<VatValidationResult>>('/portal/account/validate-vat'),
    contacts: {
      list: () => http.get<Data<ClientContact[]>>('/portal/account/contacts'),
      create: (body: CreateClientContact & { password?: string }) =>
        http.post<Data<ClientContact>>('/portal/account/contacts', body),
      update: (id: string, body: UpdateClientContact & { password?: string }) =>
        http.patch<Data<ClientContact>>(`/portal/account/contacts/${id}`, body),
      remove: (id: string) => http.delete<void>(`/portal/account/contacts/${id}`),
    },
    emails: (q?: ListQuery) => http.get<Paginated<EmailLogEntry>>('/portal/account/emails', q),
    announcements: () => http.get<Data<Announcement[]>>('/portal/announcements'),
  },
  services: {
    list: (q?: ListQuery) => http.get<Paginated<ServiceListItem>>('/portal/services', q),
    get: (id: string) => http.get<Data<ServiceDetail>>(`/portal/services/${id}`),
    loginUrl: (id: string) =>
      http.post<Data<ProvisioningLoginUrl>>(`/portal/services/${id}/login-url`),
    changePassword: (id: string, password: string) =>
      http.post<Data<QueuedJob>>(`/portal/services/${id}/change-password`, { password }),
    upgradeOptions: (id: string) =>
      http.get<Data<UpgradeOption[]>>(`/portal/services/${id}/change-package/options`),
    upgradePreview: (id: string, body: { productId: string; billingCycle: string }) =>
      http.post<Data<ProrationPreview>>(`/portal/services/${id}/change-package/preview`, body),
    upgrade: (id: string, body: { productId: string; billingCycle: string }) =>
      http.post<Data<{ invoiceId: string | null; serviceId: string }>>(
        `/portal/services/${id}/change-package`,
        body,
      ),
    cancel: (id: string, body: { type: CancellationType; reason?: string }) =>
      http.post<Data<ServiceDetail>>(`/portal/services/${id}/cancel`, body),
    power: (id: string, action: PowerAction) =>
      http.post<Data<QueuedJob>>(`/portal/services/${id}/power`, { action }),
    usage: (id: string, range: '1h' | '24h' | '7d' = '24h') =>
      http.get<Data<UsageInfo>>(`/portal/services/${id}/usage`, { range }),
    /** Module specific actions (Skrime servers: console, network, rDNS, firewall, backups, reinstall). */
    extras: (id: string) =>
      http.get<Data<ModuleExtraDescriptor[]>>(`/portal/services/${id}/extras`),
    runExtra: <T = unknown>(id: string, action: string, params: Record<string, unknown> = {}) =>
      http.post<Data<T>>(`/portal/services/${id}/extras/${action}`, { params }),
  },
  domains: {
    list: (q?: ListQuery) => http.get<Paginated<PortalDomain>>('/portal/domains', q),
    get: (id: string) => http.get<Data<PortalDomain>>(`/portal/domains/${id}`),
    update: (id: string, body: UpdateDomain) =>
      http.patch<Data<PortalDomain>>(`/portal/domains/${id}`, body),
    eppCode: (id: string) => http.post<EppCodeResponse>(`/portal/domains/${id}/epp-code`),
    /** Returns the domain + job; when billing creates an invoice first, `invoiceId` is set. */
    renew: (id: string, years: number) =>
      http.post<ActionResponse<PortalDomain> & { invoiceId?: string | null }>(
        `/portal/domains/${id}/renew`,
        { years },
      ),
  },
  invoices: {
    list: (q?: ListQuery) => http.get<Paginated<InvoiceListItem>>('/portal/invoices', q),
    get: (id: string) => http.get<Data<InvoiceWithItems>>(`/portal/invoices/${id}`),
    transactions: (id: string) =>
      http.get<Data<Transaction[]>>(`/portal/invoices/${id}/transactions`),
    /** Direct link (the browser follows it with the session cookie). */
    pdfUrl: (id: string) => `${API_URL}/api/v1/portal/invoices/${id}/pdf`,
    pay: (
      id: string,
      body: { gateway: string; paymentMethodId?: string; saveMethod?: boolean; returnUrl?: string },
    ) => http.post<Data<PaymentStart>>(`/portal/invoices/${id}/pay`, body),
  },
  payments: {
    gateways: () => http.get<Data<PortalGateway[]>>('/portal/payments/gateways'),
    methods: () => http.get<Data<PaymentMethod[]>>('/portal/payments/methods'),
    addMethod: (body: { gateway: string; returnUrl?: string }) =>
      http.post<Data<SetupStart>>('/portal/payments/methods', body),
    removeMethod: (id: string) => http.delete<void>(`/portal/payments/methods/${id}`),
    setDefault: (id: string) =>
      http.post<Data<PaymentMethod>>(`/portal/payments/methods/${id}/default`),
    autoPay: () => http.get<Data<AutoPaySettings>>('/portal/payments/auto-pay'),
    setAutoPay: (body: Partial<AutoPaySettings>) =>
      http.put<Data<AutoPaySettings>>('/portal/payments/auto-pay', body),
  },
  tickets: {
    list: (q?: ListQuery) => http.get<Paginated<TicketListItem>>('/portal/tickets', q),
    get: (id: string) => http.get<Data<TicketDetail>>(`/portal/tickets/${id}`),
    departments: () => http.get<Data<PublicTicketDepartment[]>>('/portal/tickets/departments'),
    uploadAttachment: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return postForm<Data<UploadedAttachment>>('/portal/tickets/attachments', form);
    },
    create: (body: {
      departmentId: string;
      subject: string;
      body: string;
      priority: string;
      serviceId?: string | null;
      domainId?: string | null;
      attachmentIds: string[];
    }) => http.post<Data<Ticket>>('/portal/tickets', body),
    reply: (id: string, body: { body: string; attachmentIds: string[]; status?: 'closed' }) =>
      http.post<Data<TicketReply>>(`/portal/tickets/${id}/replies`, body),
    close: (id: string) => http.post<Data<Ticket>>(`/portal/tickets/${id}/close`),
    attachmentUrl: (ticketId: string, attachmentId: string) =>
      `${API_URL}/api/v1/portal/tickets/${ticketId}/attachments/${attachmentId}`,
  },
  orders: {
    create: (body: { items: CartItem[]; promoCode?: string; notes?: string }) =>
      http.post<Data<OrderWithItems>>('/portal/orders', body),
    quote: (body: { items: CartItem[]; promoCode?: string }) =>
      http.post<Data<CartQuote>>('/portal/orders/quote', body),
    list: (q?: ListQuery) => http.get<Paginated<Order>>('/portal/orders', q),
  },
};

/** `GET /public/products` returns visible groups with their products; both helpers below read it. */
type PublicCatalog = Array<ProductGroup & { products: ProductWithPrices[] }>;
const publicCatalog = () => http.get<Data<PublicCatalog>>('/public/products');

export const publicApi = {
  catalog: {
    groups: async (): Promise<Data<ProductGroup[]>> => {
      const res = await publicCatalog();
      return { data: res.data.map(({ products: _products, ...group }) => group) };
    },
    products: async (groupId?: string): Promise<Data<ProductWithPrices[]>> => {
      const res = await publicCatalog();
      return {
        data: res.data.filter((g) => !groupId || g.id === groupId).flatMap((g) => g.products),
      };
    },
    product: (idOrSlug: string) =>
      http.get<Data<ProductWithPrices & { configurableOptions?: ConfigurableOption[] }>>(
        `/public/products/${idOrSlug}`,
      ),
  },
  domains: {
    /** `availabilityQuerySchema`: full `domain` or `sld` + `tlds`. */
    check: (q: { domain?: string; sld?: string; tlds?: string[]; limit?: number }) =>
      http.get<AvailabilityResponse>('/public/domains/availability', {
        domain: q.domain,
        sld: q.sld,
        tlds: q.tlds?.join(','),
        limit: q.limit,
      }),
    tlds: () => http.get<Data<PublicTld[]>>('/public/tlds'),
  },
  orders: {
    /** Guest cart quote: tax from `country` / `vatNumber`, promo validation. */
    quote: (body: { items: CartItem[]; country: string; vatNumber?: string; promoCode?: string }) =>
      http.post<Data<CartQuote & { promoValid?: boolean | null }>>('/public/orders/quote', body),
  },
  auth: {
    register: (body: RegisterRequest) =>
      http.post<{ data: AuthUser; verificationRequired?: boolean }>('/auth/register', body),
  },
};

/** True when the backend route does not exist yet (404 on a collection/action endpoint). */
export function isEndpointMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

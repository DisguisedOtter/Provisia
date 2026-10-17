import type {
  ApiKey,
  CannedResponse,
  Client,
  ClientContact,
  ClientWithUser,
  ConfigureGateway,
  CreateApiKey,
  CreateClient,
  CreateClientContact,
  CreateCreditNote,
  CreatedApiKey,
  CreateInvoice,
  CreateProduct,
  CreateProductGroup,
  CreateRole,
  CreateServer,
  CreateService,
  CreateStaffUser,
  CreateTicket,
  CreateTicketDepartment,
  CreateTicketReply,
  CreateTld,
  CreateTransaction,
  CreditAdjustment,
  CreditNote,
  Domain,
  DomainActionResponse,
  DomainSyncLogEntry,
  EmailLogDetail,
  EmailLogEntry,
  EmailTemplate,
  ImportTldPricing,
  Invoice,
  InvoiceWithItems,
  MarkInvoicePaid,
  Notification,
  Order,
  OrderWithItems,
  PaymentGatewayInfo,
  PermissionDescriptor,
  PreviewEmailTemplate,
  ProductGroup,
  ProductWithPrices,
  ProvisionerDescriptor,
  ProvisioningLog,
  ProvisioningLoginUrl,
  QueuedJob,
  RegistrarAccount,
  RegistrarModuleInfo,
  RemoteOption,
  RemoteOptionKind,
  RenderedEmail,
  Role,
  Server,
  ServerCapacity,
  ServerGroup,
  Service,
  ServiceUsage,
  Settings,
  StaffUser,
  TaxRule,
  TestConnectionResult,
  Ticket,
  TicketDepartment,
  TicketDetail,
  TicketListItem,
  TicketNote,
  TicketReply,
  TldWithPrices,
  Transaction,
  UpdateClient,
  UpdateInvoice,
  UpdateInvoiceItem,
  UpdateProduct,
  UpdateRole,
  UpdateServer,
  UpdateService,
  UpdateStaffUser,
  UpdateTicket,
  UpdateTld,
  UpsertEmailTemplate,
  VatValidationResult,
} from '@provisia/shared';
import { API_URL, type Data, http, type Paginated } from '@/lib/api';
import type {
  ActivityLogEntry,
  AutomationStatus,
  ClientNote,
  DashboardStats,
  ImpersonateResult,
  JobEnqueued,
  JobLogEntry,
  ListQuery,
  ModuleInfo,
  ModuleKind,
  SearchResults,
} from './types';

type AdminUpdateDomain = import('@provisia/shared').AdminUpdateDomain;
type CreateInvoiceItem = import('@provisia/shared').CreateInvoice['items'][number];
type CreateCannedResponse = { departmentId?: string | null; title: string; body: string };
type CreditNoteWithItems = CreditNote & { items: unknown[] };
type SmtpTestResult = { ok: boolean; message: string; messageId?: string };

/**
 * Typed client for every `/api/v1/admin/*` endpoint the admin UI uses.
 * Paths follow ARCHITECTURE.md section 6. Routes not yet implemented by the API are listed
 * in ./ENDPOINTS.md; pages degrade gracefully (empty state + toast) when a call 404s.
 */
export const adminApi = {
  dashboard: {
    stats: () => http.get<Data<DashboardStats>>('/admin/dashboard'),
  },
  notifications: {
    list: (q?: ListQuery) =>
      http.get<Paginated<Notification> & { meta: { unread?: number } }>('/admin/notifications', q),
    markRead: (id: string) => http.post<void>(`/admin/notifications/${id}/read`),
    markAllRead: () => http.post<void>('/admin/notifications/read-all'),
  },
  search: (q: string, signal?: AbortSignal) =>
    http.get<Data<SearchResults>>('/admin/search', { q }, signal),
  modules: {
    list: (kind?: ModuleKind) => http.get<Data<ModuleInfo[]>>('/admin/modules', { kind }),
    provisioners: () => http.get<Data<ProvisionerDescriptor[]>>('/admin/provisioners'),
    registrars: () => http.get<Data<RegistrarModuleInfo[]>>('/admin/registrars'),
    /** Remote option lists referenced from module JSON schemas (`x-options`). */
    options: (endpoint: string) => http.get<Data<Array<Record<string, unknown>>>>(endpoint),
  },
  activity: {
    list: (q?: ListQuery) => http.get<Paginated<ActivityLogEntry>>('/admin/activity-log', q),
  },

  clients: {
    list: (q?: ListQuery) => http.get<Paginated<ClientWithUser>>('/admin/clients', q),
    get: (id: string) => http.get<Data<ClientWithUser>>(`/admin/clients/${id}`),
    create: (body: CreateClient) => http.post<Data<ClientWithUser>>('/admin/clients', body),
    update: (id: string, body: UpdateClient) =>
      http.patch<Data<ClientWithUser>>(`/admin/clients/${id}`, body),
    remove: (id: string) => http.delete<void>(`/admin/clients/${id}`),
    validateVat: (id: string) =>
      http.post<Data<VatValidationResult>>(`/admin/clients/${id}/validate-vat`),
    adjustCredit: (id: string, body: CreditAdjustment) =>
      http.post<Data<{ transaction: Transaction; creditBalance: number }>>(
        `/admin/clients/${id}/credit`,
        body,
      ),
    /** Auth agent: starts an impersonated session for the client's user. */
    loginAs: (userId: string) =>
      http.post<Data<ImpersonateResult | Client | null>>('/auth/impersonate', { userId }),
    contacts: {
      list: (id: string) => http.get<Data<ClientContact[]>>(`/admin/clients/${id}/contacts`),
      create: (id: string, body: CreateClientContact) =>
        http.post<Data<ClientContact>>(`/admin/clients/${id}/contacts`, body),
      update: (id: string, contactId: string, body: Partial<CreateClientContact>) =>
        http.patch<Data<ClientContact>>(`/admin/clients/${id}/contacts/${contactId}`, body),
      remove: (id: string, contactId: string) =>
        http.delete<void>(`/admin/clients/${id}/contacts/${contactId}`),
    },
    notes: {
      list: (id: string) => http.get<Data<ClientNote[]>>(`/admin/clients/${id}/notes`),
      create: (id: string, body: { body: string }) =>
        http.post<Data<ClientNote>>(`/admin/clients/${id}/notes`, body),
      remove: (id: string, noteId: string) =>
        http.delete<void>(`/admin/clients/${id}/notes/${noteId}`),
    },
  },

  orders: {
    list: (q?: ListQuery) => http.get<Paginated<Order>>('/admin/orders', q),
    get: (id: string) => http.get<Data<OrderWithItems>>(`/admin/orders/${id}`),
    accept: (id: string) => http.post<Data<OrderWithItems>>(`/admin/orders/${id}/accept`),
    cancel: (id: string, body?: { reason?: string }) =>
      http.post<Data<OrderWithItems>>(`/admin/orders/${id}/cancel`, body),
    fraud: (id: string) => http.post<Data<OrderWithItems>>(`/admin/orders/${id}/fraud`),
  },

  productGroups: {
    list: () =>
      http.get<Paginated<ProductGroup>>('/admin/product-groups', {
        perPage: 100,
        includeHidden: true,
      }),
    create: (body: CreateProductGroup) =>
      http.post<Data<ProductGroup>>('/admin/product-groups', body),
    update: (id: string, body: Partial<CreateProductGroup>) =>
      http.patch<Data<ProductGroup>>(`/admin/product-groups/${id}`, body),
    remove: (id: string) => http.delete<void>(`/admin/product-groups/${id}`),
  },
  products: {
    list: (q?: ListQuery) =>
      http.get<Paginated<ProductWithPrices>>('/admin/products', { includeHidden: true, ...q }),
    get: (id: string) => http.get<Data<ProductWithPrices>>(`/admin/products/${id}`),
    create: (body: CreateProduct) => http.post<Data<ProductWithPrices>>('/admin/products', body),
    update: (id: string, body: UpdateProduct) =>
      http.patch<Data<ProductWithPrices>>(`/admin/products/${id}`, body),
    remove: (id: string) => http.delete<void>(`/admin/products/${id}`),
  },

  services: {
    list: (q?: ListQuery) => http.get<Paginated<Service>>('/admin/services', q),
    get: (id: string) => http.get<Data<Service>>(`/admin/services/${id}`),
    create: (body: CreateService) => http.post<Data<Service>>('/admin/services', body),
    update: (id: string, body: UpdateService) =>
      http.patch<Data<Service>>(`/admin/services/${id}`, body),
    /** Provisioning agent: `POST /admin/services/:id/provisioning/:action` → queued job. */
    action: (id: string, action: string, body?: Record<string, unknown>) =>
      http.post<Data<QueuedJob>>(`/admin/services/${id}/provisioning/${action}`, body ?? {}),
    loginUrl: (id: string) =>
      http.post<Data<ProvisioningLoginUrl>>(`/admin/services/${id}/provisioning/loginUrl`, {}),
    usage: (id: string) => http.get<Data<ServiceUsage | null>>(`/admin/services/${id}/usage`),
    log: (id: string, q?: ListQuery) =>
      http.get<Paginated<ProvisioningLog>>(`/admin/services/${id}/provisioning-log`, q),
  },

  domains: {
    list: (q?: ListQuery) => http.get<Paginated<Domain>>('/admin/domains', q),
    get: (id: string) => http.get<Data<Domain>>(`/admin/domains/${id}`),
    update: (id: string, body: AdminUpdateDomain) =>
      http.patch<Data<Domain>>(`/admin/domains/${id}`, body),
    renew: (id: string, body: { years: number }) =>
      http.post<DomainActionResponse>(`/admin/domains/${id}/renew`, body),
    sync: (id: string) => http.post<DomainActionResponse>(`/admin/domains/${id}/sync`),
    register: (id: string) => http.post<DomainActionResponse>(`/admin/domains/${id}/register`),
    setNameservers: (id: string, nameservers: string[]) =>
      http.post<DomainActionResponse>(`/admin/domains/${id}/nameservers`, { nameservers }),
    setLock: (id: string, locked: boolean) =>
      http.post<DomainActionResponse>(`/admin/domains/${id}/lock`, { locked }),
    epp: (id: string) =>
      http.get<Data<{ eppCode: string; expiresAt?: string }>>(`/admin/domains/${id}/epp`),
    syncLog: (id: string, q?: ListQuery) =>
      http.get<Paginated<DomainSyncLogEntry>>(`/admin/domains/${id}/log`, q),
    tlds: {
      list: (q?: ListQuery) =>
        http.get<Paginated<TldWithPrices>>('/admin/tlds', { perPage: 100, ...q }),
      create: (body: CreateTld) => http.post<Data<TldWithPrices>>('/admin/tlds', body),
      update: (id: string, body: UpdateTld) =>
        http.patch<Data<TldWithPrices>>(`/admin/tlds/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/tlds/${id}`),
      import: (body: ImportTldPricing) =>
        http.post<Data<{ imported: number; created: number; updated: number } | JobEnqueued>>(
          '/admin/tlds/import',
          body,
        ),
    },
    registrars: {
      list: () => http.get<Data<RegistrarAccount[]>>('/admin/registrar-accounts'),
      upsert: (
        module: string,
        body: { name?: string; enabled?: boolean; config: Record<string, unknown> },
      ) => http.put<Data<RegistrarAccount>>(`/admin/registrar-accounts/${module}`, body),
    },
  },

  invoices: {
    list: (q?: ListQuery) => http.get<Paginated<Invoice>>('/admin/invoices', q),
    get: (id: string) => http.get<Data<InvoiceWithItems>>(`/admin/invoices/${id}`),
    create: (body: CreateInvoice) => http.post<Data<InvoiceWithItems>>('/admin/invoices', body),
    update: (id: string, body: UpdateInvoice) =>
      http.patch<Data<InvoiceWithItems>>(`/admin/invoices/${id}`, body),
    items: {
      add: (id: string, body: CreateInvoiceItem) =>
        http.post<Data<InvoiceWithItems>>(`/admin/invoices/${id}/items`, body),
      update: (id: string, itemId: string, body: UpdateInvoiceItem) =>
        http.patch<Data<InvoiceWithItems>>(`/admin/invoices/${id}/items/${itemId}`, body),
      remove: (id: string, itemId: string) =>
        http.delete<Data<InvoiceWithItems> | undefined>(`/admin/invoices/${id}/items/${itemId}`),
    },
    issue: (id: string) => http.post<Data<InvoiceWithItems>>(`/admin/invoices/${id}/issue`),
    markPaid: (id: string, body: MarkInvoicePaid) =>
      http.post<Data<InvoiceWithItems>>(`/admin/invoices/${id}/mark-paid`, body),
    cancel: (id: string, body?: { reason?: string | null }) =>
      http.post<Data<InvoiceWithItems>>(`/admin/invoices/${id}/cancel`, body ?? {}),
    refund: (id: string, body: { transactionId?: string; amount?: number; reason?: string }) =>
      http.post<Data<Transaction>>(`/admin/invoices/${id}/refund`, body),
    creditNote: (id: string, body: CreateCreditNote) =>
      http.post<Data<CreditNoteWithItems>>(`/admin/invoices/${id}/credit-note`, body),
    send: (id: string, body?: { to?: string }) =>
      http.post<void>(`/admin/invoices/${id}/send`, body ?? {}),
    pdfUrl: (id: string) => `${API_URL}/api/v1/admin/invoices/${id}/pdf`,
    creditNotes: (q?: ListQuery) => http.get<Paginated<CreditNote>>('/admin/credit-notes', q),
  },
  transactions: {
    list: (q?: ListQuery) => http.get<Paginated<Transaction>>('/admin/transactions', q),
    create: (body: CreateTransaction) => http.post<Data<Transaction>>('/admin/transactions', body),
    refund: (id: string, body: { amount?: number; reason?: string }) =>
      http.post<Data<Transaction>>(`/admin/transactions/${id}/refund`, body),
  },

  tickets: {
    list: (q?: ListQuery) => http.get<Paginated<TicketListItem>>('/admin/tickets', q),
    get: (id: string) => http.get<Data<TicketDetail>>(`/admin/tickets/${id}`),
    create: (body: CreateTicket) => http.post<Data<Ticket>>('/admin/tickets', body),
    update: (id: string, body: UpdateTicket) =>
      http.patch<Data<Ticket>>(`/admin/tickets/${id}`, body),
    reply: (id: string, body: CreateTicketReply) =>
      http.post<Data<TicketReply>>(`/admin/tickets/${id}/replies`, body),
    addNote: (id: string, body: { body: string }) =>
      http.post<Data<TicketNote>>(`/admin/tickets/${id}/notes`, body),
    removeNote: (id: string, noteId: string) =>
      http.delete<void>(`/admin/tickets/${id}/notes/${noteId}`),
    upload: async (id: string | null, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const path = id ? `/admin/tickets/${id}/attachments` : '/admin/tickets/attachments';
      const res = await fetch(`${API_URL}/api/v1${path}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as
        | Data<{ id: string; name: string; size: number; mimeType: string }>
        | { error?: { message?: string } }
        | null;
      if (!res.ok)
        throw new Error(
          (json as { error?: { message?: string } } | null)?.error?.message ?? 'Upload failed',
        );
      return json as Data<{ id: string; name: string; size: number; mimeType: string }>;
    },
    attachmentUrl: (ticketId: string, attachmentId: string) =>
      `${API_URL}/api/v1/admin/tickets/${ticketId}/attachments/${attachmentId}`,
    departments: {
      list: () =>
        http.get<Paginated<TicketDepartment>>('/admin/ticket-departments', { perPage: 100 }),
      create: (body: CreateTicketDepartment) =>
        http.post<Data<TicketDepartment>>('/admin/ticket-departments', body),
      update: (id: string, body: Partial<CreateTicketDepartment>) =>
        http.patch<Data<TicketDepartment>>(`/admin/ticket-departments/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/ticket-departments/${id}`),
    },
    canned: {
      list: () => http.get<Paginated<CannedResponse>>('/admin/canned-responses', { perPage: 100 }),
      create: (body: CreateCannedResponse) =>
        http.post<Data<CannedResponse>>('/admin/canned-responses', body),
      update: (id: string, body: Partial<CreateCannedResponse>) =>
        http.patch<Data<CannedResponse>>(`/admin/canned-responses/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/canned-responses/${id}`),
    },
  },

  servers: {
    list: (q?: ListQuery) =>
      http.get<Paginated<ServerCapacity>>('/admin/servers', { perPage: 100, ...q }),
    get: (id: string) => http.get<Data<ServerCapacity>>(`/admin/servers/${id}`),
    create: (body: CreateServer) => http.post<Data<Server>>('/admin/servers', body),
    update: (id: string, body: UpdateServer) =>
      http.patch<Data<Server>>(`/admin/servers/${id}`, body),
    remove: (id: string) => http.delete<void>(`/admin/servers/${id}`),
    test: (id: string) => http.post<Data<TestConnectionResult>>(`/admin/servers/${id}/test`),
    options: (id: string, kind: RemoteOptionKind) =>
      http.get<Data<RemoteOption[]>>(`/admin/servers/${id}/options/${kind}`),
    groups: {
      list: () => http.get<Paginated<ServerGroup>>('/admin/server-groups', { perPage: 100 }),
      create: (body: {
        name: string;
        description?: string | null;
        fillType?: 'least_loaded' | 'fill_first';
      }) => http.post<Data<ServerGroup>>('/admin/server-groups', body),
      update: (
        id: string,
        body: Partial<{
          name: string;
          description: string | null;
          fillType: 'least_loaded' | 'fill_first';
        }>,
      ) => http.patch<Data<ServerGroup>>(`/admin/server-groups/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/server-groups/${id}`),
    },
  },

  settings: {
    get: () => http.get<Data<Settings>>('/admin/settings'),
    update: (body: Partial<Settings>) => http.patch<Data<Settings>>('/admin/settings', body),
    taxRules: {
      list: () => http.get<Paginated<TaxRule>>('/admin/tax-rules', { perPage: 100 }),
      create: (body: Omit<TaxRule, 'id' | 'createdAt'>) =>
        http.post<Data<TaxRule>>('/admin/tax-rules', body),
      update: (id: string, body: Partial<Omit<TaxRule, 'id' | 'createdAt'>>) =>
        http.patch<Data<TaxRule>>(`/admin/tax-rules/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/tax-rules/${id}`),
    },
    gateways: {
      list: () => http.get<Data<PaymentGatewayInfo[]>>('/admin/gateways'),
      configure: (id: string, body: ConfigureGateway) =>
        http.put<Data<PaymentGatewayInfo>>(`/admin/gateways/${id}`, body),
      test: (id: string) =>
        http.post<Data<{ ok: boolean; message?: string }>>(`/admin/gateways/${id}/test`),
    },
    email: {
      testSmtp: (body: { to: string }) =>
        http.post<Data<SmtpTestResult>>('/admin/email/test', body),
      templates: () => http.get<Data<EmailTemplate[]>>('/admin/email/templates'),
      template: (key: string, locale: string) =>
        http.get<Data<EmailTemplate>>(`/admin/email/templates/${key}`, { locale }),
      updateTemplate: (key: string, locale: string, body: UpsertEmailTemplate) =>
        http.put<Data<EmailTemplate>>(`/admin/email/templates/${key}`, { ...body, locale }),
      resetTemplate: (key: string, locale: string) =>
        http.delete<void>(`/admin/email/templates/${key}?locale=${encodeURIComponent(locale)}`),
      preview: (key: string, body: PreviewEmailTemplate & { locale?: string }) =>
        http.post<Data<RenderedEmail>>(`/admin/email/templates/${key}/preview`, body),
      log: (q?: ListQuery) => http.get<Paginated<EmailLogEntry>>('/admin/email/log', q),
      logEntry: (id: string) => http.get<Data<EmailLogDetail>>(`/admin/email/log/${id}`),
      resend: (id: string) => http.post<void>(`/admin/email/log/${id}/resend`),
    },
    staff: {
      list: (q?: ListQuery) => http.get<Paginated<StaffUser>>('/admin/staff', q),
      get: (id: string) => http.get<Data<StaffUser>>(`/admin/staff/${id}`),
      create: (body: CreateStaffUser) => http.post<Data<StaffUser>>('/admin/staff', body),
      invite: (body: Omit<CreateStaffUser, 'password'>) =>
        http.post<Data<StaffUser>>('/admin/staff/invite', body),
      update: (id: string, body: UpdateStaffUser) =>
        http.patch<Data<StaffUser>>(`/admin/staff/${id}`, body),
      remove: (id: string) => http.delete<void>(`/admin/staff/${id}`),
      resetTotp: (id: string) => http.post<void>(`/admin/staff/${id}/reset-2fa`),
      roles: {
        list: () => http.get<Paginated<Role>>('/admin/roles', { perPage: 100 }),
        create: (body: CreateRole) => http.post<Data<Role>>('/admin/roles', body),
        update: (id: string, body: UpdateRole) =>
          http.patch<Data<Role>>(`/admin/roles/${id}`, body),
        remove: (id: string) => http.delete<void>(`/admin/roles/${id}`),
        permissions: () => http.get<Data<PermissionDescriptor[]>>('/admin/permissions'),
      },
    },
    apiKeys: {
      list: () => http.get<Paginated<ApiKey>>('/admin/api-keys', { perPage: 100 }),
      create: (body: CreateApiKey) => http.post<Data<CreatedApiKey>>('/admin/api-keys', body),
      revoke: (id: string) => http.delete<void>(`/admin/api-keys/${id}`),
    },
    automation: {
      status: () => http.get<Data<AutomationStatus>>('/admin/automation/status'),
      jobs: (q?: ListQuery) => http.get<Paginated<JobLogEntry>>('/admin/automation/jobs', q),
      retry: (id: string) => http.post<void>(`/admin/automation/jobs/${id}/retry`),
      run: (body: { queue: string; name: string }) =>
        http.post<Data<JobEnqueued>>('/admin/automation/run', body),
    },
  },

  /** Lightweight lookups for pickers. */
  lookup: {
    clients: (search: string) =>
      http.get<Paginated<ClientWithUser>>('/admin/clients', { search, perPage: 10 }),
    products: () =>
      http.get<Paginated<ProductWithPrices>>('/admin/products', {
        perPage: 100,
        includeHidden: true,
      }),
    staff: () => http.get<Paginated<StaffUser>>('/admin/staff', { perPage: 100 }),
    departments: () =>
      http.get<Paginated<TicketDepartment>>('/admin/ticket-departments', { perPage: 100 }),
    servers: () => http.get<Paginated<ServerCapacity>>('/admin/servers', { perPage: 100 }),
  },
};

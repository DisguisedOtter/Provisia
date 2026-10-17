/**
 * DTO types for admin endpoints whose zod schemas are not (yet) in `@provisia/shared`.
 * Everything that exists in shared is re-exported from there; swap local types out as
 * backend agents land theirs. Every assumed shape is also listed in ./ENDPOINTS.md.
 */
import type { Order, Service, Ticket } from '@provisia/shared';

export type ListQuery = {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  [key: string]: string | number | boolean | undefined | null;
};

// ----- Dashboard (assumed: GET /admin/dashboard) -----
export interface DashboardStats {
  currency: string;
  revenueThisMonth: number;
  revenuePreviousMonth?: number;
  outstanding: number;
  overdue: number;
  counts: {
    clients: number;
    activeServices: number;
    openTickets: number;
    pendingOrders: number;
    unpaidInvoices: number;
    overdueInvoices: number;
    failedJobs?: number;
  };
  recentOrders: Order[];
  openTickets: Ticket[];
  servicesDue: Service[];
  failedJobs: JobLogEntry[];
}

// ----- Global search (assumed: GET /admin/search?q=) -----
export interface SearchResults {
  clients: Array<{
    id: string;
    companyName: string | null;
    email?: string;
    firstName?: string;
    lastName?: string;
  }>;
  domains: Array<{ id: string; name: string; status: string }>;
  invoices: Array<{
    id: string;
    number: string | null;
    status: string;
    total: number;
    currency: string;
  }>;
  tickets: Array<{ id: string; number: string; subject: string; status: string }>;
  services?: Array<{ id: string; domain: string | null; status: string }>;
}

// ----- Client notes (assumed) -----
export interface ClientNote {
  id: string;
  clientId: string;
  authorUserId: string | null;
  authorName?: string | null;
  body: string;
  createdAt: string;
}

// ----- Activity log (table exists; endpoint assumed: GET /admin/activity-log) -----
export interface ActivityLogEntry {
  id: string;
  actorUserId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

// ----- JSON schema (module configSchema serialised by the API) -----
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  const?: unknown;
  /** Provisia extension: load options from an endpoint, e.g. `/admin/servers/:serverId/options/packages`. */
  'x-options'?: { endpoint: string; labelKey?: string; valueKey?: string } | string;
  'x-secret'?: boolean;
  'x-widget'?: 'textarea' | 'password' | 'select' | 'checkbox';
}

export type ModuleKind = 'gateway' | 'registrar' | 'provisioner';
/** Generic module listing (GET /admin/modules?kind=). Provisioners add the descriptor fields. */
export interface ModuleInfo {
  kind?: ModuleKind;
  id: string;
  name: string;
  version: string;
  configSchema?: JsonSchema;
  credentialsSchema?: JsonSchema | null;
  capabilities?: Record<string, boolean>;
  configured?: boolean;
}

export interface JobEnqueued {
  jobId: string;
  queue: string;
  name: string;
}

// ----- Automation (assumed) -----
export interface JobLogEntry {
  id: string;
  queue: string;
  name: string;
  jobId: string;
  status: 'running' | 'completed' | 'failed' | string;
  attempts: number;
  error: string | null;
  result: unknown;
  data?: unknown;
  startedAt: string;
  finishedAt: string | null;
}
export interface AutomationStatus {
  workerOnline: boolean;
  lastHeartbeatAt: string | null;
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    paused?: boolean;
  }>;
  schedules: Array<{
    id: string;
    queue: string;
    name: string;
    pattern?: string;
    every?: number;
    nextRunAt: string | null;
    lastRunAt?: string | null;
  }>;
}

// ----- Clients: login-as response (auth agent owns `/auth/impersonate`) -----
export interface ImpersonateResult {
  redirectUrl?: string;
}

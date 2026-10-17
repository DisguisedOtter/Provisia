import {
  defineProvisioner,
  type ModuleContext,
  type ProvisionResult,
  type RemoteOption,
  type ServerDTO,
  type ServiceDTO,
  type UsageInfo,
} from '@provisia/module-sdk';
import { deriveUsername, generatePassword } from '@provisia/shared';
import { bytesToMb, PleskClient, PleskError } from './client.js';
import {
  type PleskConfig,
  type PleskCredentials,
  pleskConfigSchema,
  pleskCredentialsSchema,
} from './config.js';

export { PleskClient, PleskError } from './client.js';
export * from './config.js';

type Ctx = ModuleContext<PleskConfig>;

/** What we persist in `services.module_data`. */
interface PleskModuleData {
  customerId?: number;
  customerLogin?: string;
  domainId: number;
  domain: string;
  sysUser: string;
  servicePlan: string;
}

function client(ctx: ModuleContext<unknown>, server: ServerDTO | null): PleskClient {
  if (!server) throw new PleskError('no_server', 'Service has no server assigned');
  const creds = pleskCredentialsSchema.parse(ctx.credentials) as PleskCredentials;
  return new PleskClient(ctx.fetch, server, creds);
}

function dataOf(service: ServiceDTO): PleskModuleData {
  const d = service.moduleData as Partial<PleskModuleData>;
  if (!d.domainId) throw new PleskError('not_provisioned', 'Service has no Plesk subscription id');
  return d as PleskModuleData;
}

const plesk = defineProvisioner({
  id: 'plesk',
  name: 'Plesk',
  version: '1.0.0',
  configSchema: pleskConfigSchema,
  credentialsSchema: pleskCredentialsSchema,

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const api = client(ctx, service.server);
    if (!service.domain)
      throw new PleskError('domain_required', 'Plesk subscriptions need a domain');
    const username = service.username ?? deriveUsername(service.domain, 16);
    const password = service.password ?? generatePassword();

    let customerId: number | undefined;
    if (ctx.config.createCustomer) {
      const customer = await api.post<{ id: number }>('/clients', {
        name: service.client.name,
        company: service.client.companyName ?? undefined,
        login: username,
        email: service.client.email,
        password,
        type: 'customer',
      });
      customerId = customer.id;
    }

    let domain: { id: number };
    try {
      domain = await api.post<{ id: number }>('/domains', {
        name: service.domain,
        hosting_type: 'virtual',
        hosting_settings: { ftp_login: username, ftp_password: password },
        plan: { name: ctx.config.servicePlan },
        ...(customerId ? { owner_client: { id: customerId } } : {}),
        ...(ctx.config.ipAddress ? { ip_addresses: [ctx.config.ipAddress] } : {}),
      });
    } catch (err) {
      // Roll back the customer so a retry does not hit "login already exists".
      if (customerId) await api.delete(`/clients/${customerId}`).catch(() => undefined);
      throw err;
    }

    const moduleData: PleskModuleData = {
      customerId,
      customerLogin: customerId ? username : undefined,
      domainId: domain.id,
      domain: service.domain,
      sysUser: username,
      servicePlan: ctx.config.servicePlan,
    };
    ctx.logger.info({ domainId: domain.id, username }, 'Plesk subscription created');
    return {
      moduleData: { ...moduleData },
      username,
      password,
      ipAddress: ctx.config.ipAddress,
      message: `Subscription ${service.domain} created`,
    };
  },

  async suspend(ctx: Ctx, service) {
    const d = dataOf(service);
    await client(ctx, service.server).put(`/domains/${d.domainId}/status`, {
      status: 'suspended',
    });
  },

  async unsuspend(ctx: Ctx, service) {
    const d = dataOf(service);
    await client(ctx, service.server).put(`/domains/${d.domainId}/status`, { status: 'active' });
  },

  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    const api = client(ctx, service.server);
    try {
      await api.delete(`/domains/${d.domainId}`);
    } catch (err) {
      if (!(err instanceof PleskError && err.code === 'not_found')) throw err;
    }
    if (d.customerId) {
      try {
        await api.delete(`/clients/${d.customerId}`);
      } catch (err) {
        if (!(err instanceof PleskError && err.code === 'not_found')) throw err;
      }
    }
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const d = dataOf(service);
    const next = pleskConfigSchema.parse(newProduct.moduleConfig);
    await client(ctx, service.server).cli('subscription', [
      '--switch-subscription',
      d.domain,
      '-service-plan',
      next.servicePlan,
    ]);
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    const api = client(ctx, service.server);
    if (d.customerLogin) {
      await api.cli('customer', ['--update', d.customerLogin, '-passwd', password]);
    }
    await api.cli('subscription', ['--update', d.domain, '-login', d.sysUser, '-passwd', password]);
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const stats = await client(ctx, service.server).get<Record<string, unknown>>(
      `/domains/${d.domainId}/statistics`,
    );
    const disk = (stats.disk_space ?? stats.diskSpace ?? {}) as Record<string, unknown>;
    const traffic = (stats.traffic ?? stats.bandwidth ?? {}) as Record<string, unknown>;
    const usage: UsageInfo = { extra: {} };
    const diskUsed = bytesToMb(disk.used ?? disk.usage ?? stats.disk_usage);
    const diskLimit = bytesToMb(disk.limit ?? stats.disk_limit);
    const bwUsed = bytesToMb(traffic.used ?? traffic.usage ?? stats.traffic_usage);
    const bwLimit = bytesToMb(traffic.limit ?? stats.traffic_limit);
    if (diskUsed !== undefined) usage.diskUsedMb = diskUsed;
    if (diskLimit !== undefined && diskLimit > 0) usage.diskLimitMb = diskLimit;
    if (bwUsed !== undefined) usage.bandwidthUsedMb = bwUsed;
    if (bwLimit !== undefined && bwLimit > 0) usage.bandwidthLimitMb = bwLimit;
    for (const key of ['mailboxes', 'databases', 'subdomains'] as const) {
      if (typeof stats[key] === 'number') (usage.extra as Record<string, number>)[key] = stats[key];
    }
    return usage;
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const d = dataOf(service);
    const api = client(ctx, service.server);
    const login = d.customerLogin ?? d.sysUser;
    const key = await api.post<{ key: string }>('/auth/keys', {
      login,
      ...(ctx.config.bindLoginToIp && typeof service.moduleData.clientIp === 'string'
        ? { ip: service.moduleData.clientIp }
        : {}),
    });
    if (!key?.key) throw new PleskError('no_login_key', 'Plesk did not return a login key');
    return `${api.baseUrl}/login?secret=${encodeURIComponent(key.key)}`;
  },

  async testConnection(ctx, server) {
    try {
      const info = await client(ctx, server).get<{ hostname?: string; platform?: string }>(
        '/server',
      );
      return { ok: true, message: `Plesk on ${info.hostname ?? server.hostname}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async listRemoteOptions(ctx, server, kind): Promise<RemoteOption[]> {
    if (kind !== 'plans' && kind !== 'packages') return [];
    const plans = await client(ctx, server).get<Array<{ id: number; name: string; type?: string }>>(
      '/service-plans',
    );
    return plans
      .filter((p) => !p.type || p.type === 'hosting')
      .map((p) => ({ id: p.name, name: p.name, extra: { pleskId: p.id, type: p.type ?? null } }));
  },
});

export default plesk;

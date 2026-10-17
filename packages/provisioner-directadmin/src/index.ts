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
import { DirectadminClient, DirectadminError, parseDaNumber } from './client.js';
import {
  type DirectadminConfig,
  type DirectadminCredentials,
  directadminConfigSchema,
  directadminCredentialsSchema,
} from './config.js';

export { DirectadminClient, DirectadminError, parseDaBody, parseUrlEncoded } from './client.js';
export * from './config.js';

type Ctx = ModuleContext<DirectadminConfig>;

function client(ctx: ModuleContext<unknown>, server: ServerDTO | null): DirectadminClient {
  if (!server) throw new DirectadminError('no_server', 'Service has no server assigned');
  const creds = directadminCredentialsSchema.parse(ctx.credentials) as DirectadminCredentials;
  return new DirectadminClient(ctx.fetch, server, creds);
}

function usernameOf(service: ServiceDTO): string {
  const u = service.username ?? (service.moduleData.username as string | undefined);
  if (!u) throw new DirectadminError('no_username', 'Service has no panel username');
  return u;
}

async function selectUsers(
  ctx: Ctx,
  service: ServiceDTO,
  action: 'suspend' | 'unsuspend' | 'delete',
) {
  const params: Record<string, string> = {
    location: 'CMD_SELECT_USERS',
    select0: usernameOf(service),
  };
  if (action === 'suspend') params.suspend = 'Suspend';
  if (action === 'unsuspend') params.unsuspend = 'Unsuspend';
  if (action === 'delete') {
    params.delete = 'yes';
    params.confirmed = 'Confirm';
  }
  await client(ctx, service.server).call('CMD_API_SELECT_USERS', params);
}

const directadmin = defineProvisioner({
  id: 'directadmin',
  name: 'DirectAdmin',
  version: '1.0.0',
  configSchema: directadminConfigSchema,
  credentialsSchema: directadminCredentialsSchema,

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const da = client(ctx, service.server);
    if (!service.domain) {
      throw new DirectadminError('domain_required', 'DirectAdmin accounts need a domain');
    }
    const username = service.username ?? deriveUsername(service.domain, 10);
    const password = service.password ?? generatePassword();
    let ip = ctx.config.ip;
    if (ip === 'shared' || ip === 'server') {
      ip = await resolveIp(da, ip, service.server?.ipAddress ?? null);
    }
    await da.call('CMD_API_ACCOUNT_USER', {
      action: 'create',
      add: 'Submit',
      username,
      email: service.client.email,
      passwd: password,
      passwd2: password,
      domain: service.domain,
      package: ctx.config.package,
      ip,
      notify: ctx.config.notify,
    });
    ctx.logger.info({ username, domain: service.domain }, 'DirectAdmin account created');
    return {
      moduleData: { username, domain: service.domain, package: ctx.config.package, ip },
      username,
      password,
      ipAddress: ip,
      message: `Account ${username} created`,
    };
  },

  async suspend(ctx: Ctx, service) {
    await selectUsers(ctx, service, 'suspend');
  },

  async unsuspend(ctx: Ctx, service) {
    await selectUsers(ctx, service, 'unsuspend');
  },

  async terminate(ctx: Ctx, service) {
    await selectUsers(ctx, service, 'delete');
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const next = directadminConfigSchema.parse(newProduct.moduleConfig);
    await client(ctx, service.server).call('CMD_API_MODIFY_USER', {
      action: 'package',
      user: usernameOf(service),
      package: next.package,
    });
  },

  async changePassword(ctx: Ctx, service, password) {
    await client(ctx, service.server).call('CMD_API_USER_PASSWD', {
      username: usernameOf(service),
      passwd: password,
      passwd2: password,
    });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const da = client(ctx, service.server);
    const user = usernameOf(service);
    const usage = await da.call('CMD_API_SHOW_USER_USAGE', { user }, { method: 'GET' });
    const limits = await da.call('CMD_API_SHOW_USER_CONFIG', { user }, { method: 'GET' });
    const extra: Record<string, number | string> = {};
    for (const key of ['vdomains', 'nemails', 'mysql', 'inode', 'ftp'] as const) {
      const n = parseDaNumber(usage[key]);
      if (n !== undefined) extra[key] = n;
    }
    if (typeof limits.suspended === 'string') extra.suspended = limits.suspended;
    if (typeof limits.package === 'string') extra.package = limits.package;
    return {
      diskUsedMb: parseDaNumber(usage.quota) ?? 0,
      diskLimitMb: parseDaNumber(limits.quota),
      bandwidthUsedMb: parseDaNumber(usage.bandwidth) ?? 0,
      bandwidthLimitMb: parseDaNumber(limits.bandwidth),
      extra,
    };
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const da = client(ctx, service.server);
    const creds = directadminCredentialsSchema.parse(ctx.credentials);
    const res = await da.call(
      'CMD_API_LOGIN_KEYS',
      {
        action: 'create',
        type: 'one_time_url',
        login_keys_notify_on_creation: 0,
        clear_key: 'yes',
        expiry: ctx.config.loginKeyExpiry,
        'redirect-url': '/',
        passwd: creds.loginKey,
      },
      { loginAs: usernameOf(service) },
    );
    const url = typeof res.details === 'string' ? res.details : (res.url as string | undefined);
    if (!url || !/^https?:\/\//.test(url)) {
      throw new DirectadminError('no_login_url', 'DirectAdmin did not return a one-time URL', res);
    }
    return url;
  },

  async testConnection(ctx, server) {
    try {
      const res = await client(ctx, server).call('CMD_API_LICENSE', {}, { method: 'GET' });
      const version = typeof res.version === 'string' ? res.version : undefined;
      return { ok: true, message: version ? `DirectAdmin ${version}` : 'DirectAdmin reachable' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async listRemoteOptions(ctx, server, kind): Promise<RemoteOption[]> {
    if (kind !== 'packages') return [];
    const res = await client(ctx, server).call('CMD_API_PACKAGES_USER', {}, { method: 'GET' });
    const list = Array.isArray(res.list) ? (res.list as unknown[]) : Object.values(res);
    return list
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map((name) => ({ id: name, name }));
  },
});

async function resolveIp(
  da: DirectadminClient,
  mode: 'shared' | 'server',
  serverIp: string | null,
): Promise<string> {
  if (mode === 'server' && serverIp) return serverIp;
  const res = await da.call('CMD_API_SHOW_RESELLER_IPS', {}, { method: 'GET' });
  const ips = Array.isArray(res.list) ? (res.list as string[]) : Object.values(res).flat();
  const first = ips.find((v): v is string => typeof v === 'string' && v.length > 0);
  if (!first) {
    if (serverIp) return serverIp;
    throw new DirectadminError(
      'no_ip',
      'No IP available on the reseller; set product ip explicitly',
    );
  }
  return first;
}

export default directadmin;

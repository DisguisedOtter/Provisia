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
import { CpanelError, parseWhmSizeMb, WhmClient } from './client.js';
import {
  type CpanelConfig,
  type CpanelCredentials,
  cpanelConfigSchema,
  cpanelCredentialsSchema,
} from './config.js';

export { CpanelError, WhmClient } from './client.js';
export * from './config.js';

type Ctx = ModuleContext<CpanelConfig>;

function client(ctx: ModuleContext<unknown>, server: ServerDTO | null): WhmClient {
  if (!server) throw new CpanelError('no_server', 'Service has no server assigned');
  const creds = cpanelCredentialsSchema.parse(ctx.credentials) as CpanelCredentials;
  return new WhmClient(ctx.fetch, server, creds);
}

function usernameOf(service: ServiceDTO): string {
  const u = service.username ?? (service.moduleData.username as string | undefined);
  if (!u) throw new CpanelError('no_username', 'Service has no panel username');
  return u;
}

const cpanel = defineProvisioner({
  id: 'cpanel',
  name: 'cPanel / WHM',
  version: '1.0.0',
  configSchema: cpanelConfigSchema,
  credentialsSchema: cpanelCredentialsSchema,

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const whm = client(ctx, service.server);
    const username = service.username ?? deriveUsername(service.domain, 8);
    const password = service.password ?? generatePassword();
    if (!service.domain) throw new CpanelError('domain_required', 'cPanel accounts need a domain');
    const data = await whm.call<{ ip?: string; nameserver?: string }>('createacct', {
      username,
      domain: service.domain,
      password,
      plan: ctx.config.package,
      contactemail: service.client.email,
      reseller: ctx.config.reseller,
      owner: cpanelCredentialsSchema.parse(ctx.credentials).username,
    });
    if (ctx.config.reseller && ctx.config.aclList) {
      await whm.call('setacls', { reseller: username, acllist: ctx.config.aclList });
    }
    ctx.logger.info({ username, domain: service.domain }, 'cPanel account created');
    return {
      moduleData: { username, domain: service.domain, package: ctx.config.package, ip: data.ip },
      username,
      password,
      ipAddress: data.ip,
      message: `Account ${username} created`,
    };
  },

  async suspend(ctx: Ctx, service, reason) {
    await client(ctx, service.server).call('suspendacct', {
      user: usernameOf(service),
      reason: reason ?? 'Suspended by Provisia',
    });
  },

  async unsuspend(ctx: Ctx, service) {
    await client(ctx, service.server).call('unsuspendacct', { user: usernameOf(service) });
  },

  async terminate(ctx: Ctx, service) {
    await client(ctx, service.server).call('removeacct', {
      user: usernameOf(service),
      keepdns: ctx.config.keepDns,
    });
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const next = cpanelConfigSchema.parse(newProduct.moduleConfig);
    await client(ctx, service.server).call('changepackage', {
      user: usernameOf(service),
      pkg: next.package,
    });
  },

  async changePassword(ctx: Ctx, service, password) {
    await client(ctx, service.server).call('passwd', {
      user: usernameOf(service),
      password,
      db_pass_update: 0,
    });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const whm = client(ctx, service.server);
    const user = usernameOf(service);
    const summary = await whm.call<{ acct?: Array<Record<string, unknown>> }>('accountsummary', {
      user,
    });
    const acct = summary.acct?.[0] ?? {};
    const bw = await whm.call<{ acct?: Array<Record<string, unknown>> }>('showbw', {
      searchtype: 'user',
      search: user,
    });
    const bwAcct = bw.acct?.[0] ?? {};
    const totalBytes = Number(bwAcct.totalbytes ?? 0);
    const limitBytes = Number(bwAcct.limit ?? 0);
    const extra: Record<string, number | string> = {};
    if (acct.suspended !== undefined) extra.suspended = Number(acct.suspended);
    if (acct.ip) extra.ip = String(acct.ip);
    if (acct.plan) extra.package = String(acct.plan);
    return {
      diskUsedMb: parseWhmSizeMb(acct.diskused) ?? 0,
      diskLimitMb: parseWhmSizeMb(acct.disklimit) ?? undefined,
      bandwidthUsedMb: Math.round(totalBytes / 1024 / 1024),
      bandwidthLimitMb: limitBytes > 0 ? Math.round(limitBytes / 1024 / 1024) : undefined,
      extra,
    };
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const data = await client(ctx, service.server).call<{ url?: string }>('create_user_session', {
      user: usernameOf(service),
      service: ctx.config.loginService,
    });
    if (!data.url) throw new CpanelError('no_session_url', 'WHM did not return a session URL');
    return data.url;
  },

  async testConnection(ctx, server) {
    try {
      const data = await client(ctx, server).call<{ version?: string }>('version');
      return { ok: true, message: `WHM ${data.version ?? 'unknown version'}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async listRemoteOptions(ctx, server, kind): Promise<RemoteOption[]> {
    if (kind !== 'packages') return [];
    const data = await client(ctx, server).call<{ pkg?: Array<Record<string, unknown>> }>(
      'listpkgs',
    );
    return (data.pkg ?? []).map((p) => ({
      id: String(p.name),
      name: String(p.name),
      extra: {
        quota: String(p.QUOTA ?? ''),
        bandwidth: String(p.BWLIMIT ?? ''),
        maxAddons: String(p.MAXADDON ?? ''),
      },
    }));
  },
});

export default cpanel;

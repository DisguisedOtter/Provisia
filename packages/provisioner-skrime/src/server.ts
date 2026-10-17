import {
  defineProvisioner,
  type ModuleContext,
  type ModuleExtraAction,
  type PowerAction,
  type ProvisionResult,
  type RemoteOption,
  type ServiceDTO,
  type UsageInfo,
} from '@provisia/module-sdk';
import { generatePassword } from '@provisia/shared';
import { z } from 'zod';
import {
  clientFor,
  isNotFound,
  list,
  nameProduct,
  num,
  osOption,
  rec,
  recurringCents,
  SkrimeProvisionError,
  serverPlanOption,
  setAutoRenew,
  str,
} from './client.js';
import {
  type SkrimeServerConfig,
  type SkrimeServerData,
  skrimeCredentialsSchema,
  skrimeServerConfigSchema,
} from './config.js';
import { SKRIME_ENDPOINTS } from './endpoints.js';

type Ctx = ModuleContext<SkrimeServerConfig>;
const E = SKRIME_ENDPOINTS.server;
const P = SKRIME_ENDPOINTS.product;

function dataOf(service: ServiceDTO): SkrimeServerData {
  const d = service.moduleData as Partial<SkrimeServerData>;
  if (!d.productId) {
    throw new SkrimeProvisionError('not_provisioned', 'Service has no Skrime server assigned');
  }
  return d as SkrimeServerData;
}

/** `GET server/information` → normalised. Usage values are percent (cpu) and GB (memory, disk). */
function parseInformation(raw: unknown) {
  const status = str(raw, 'status')?.toLowerCase();
  return {
    status,
    powerState:
      status === 'online' ? 'running' : status === 'offline' ? 'stopped' : (status ?? 'unknown'),
    os: str(raw, 'os'),
    ipv4: str(raw, 'ipv4'),
    ipv6: str(raw, 'ipv6'),
    username: str(raw, 'username'),
    password: str(raw, 'password'),
    cpuPercent: num(raw, 'coresUsed'),
    memoryUsedGb: num(raw, 'memoryUsed'),
    diskUsedGb: num(raw, 'diskUsed'),
  };
}

function hostnameFor(ctx: Ctx, service: ServiceDTO): string {
  if (service.domain) return service.domain.toLowerCase();
  return `${ctx.config.hostnamePrefix}${service.id.replace(/-/g, '').slice(-8)}`.toLowerCase();
}

function orderBody(ctx: Ctx, password: string) {
  const c = ctx.config;
  const spec = c.planId
    ? { planId: c.planId }
    : {
        cores: c.cores,
        memory: c.memoryGb,
        disk: c.diskGb,
        ipv4: c.ipv4,
        ipv6: c.ipv6,
        connection: c.connection,
      };
  return {
    osName: c.osName,
    password,
    tos: true,
    cancellation: true,
    notice: true,
    prepayMonths: c.prepayMonths,
    ...spec,
  };
}

async function powerOp(ctx: ModuleContext<unknown>, service: ServiceDTO, action: 'start' | 'stop') {
  const d = dataOf(service);
  await clientFor(ctx, service.server).post(E.action, { productId: d.productId, action });
}

const ipAddressSchema = z.string().min(3).max(64);
const firewallRuleSchema = z.object({
  type: z.enum(['in', 'out']),
  action: z.enum(['ACCEPT', 'DROP', 'REJECT']),
  enable: z.union([z.boolean(), z.literal(0), z.literal(1)]).default(1),
  protocol: z.string().max(10).optional(),
  source: z.string().max(100).optional(),
  sourcePort: z.string().max(20).optional(),
  destination: z.string().max(100).optional(),
  destinationPort: z.string().max(20).optional(),
  macro: z.string().max(50).optional(),
  icmpType: z.string().max(30).optional(),
});

/** Module specific operations exposed through `/services/:id/extras/:action`. */
const extras: ModuleExtraAction[] = [
  {
    id: 'console',
    name: 'Open noVNC console',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(E.novnc, {
        productId: d.productId,
      });
      const url = str(raw, 'url');
      if (!url)
        throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a console URL');
      return { url };
    },
  },
  {
    id: 'network',
    name: 'Network (IP addresses and rDNS)',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(E.network, {
        productId: d.productId,
      });
      const entry = (e: Record<string, unknown>) => ({
        ipAddress: str(e, 'ipAddress') ?? '',
        gateway: str(e, 'gateway') ?? null,
        hostname: str(e, 'hostname') ?? null,
        zone: str(e, 'zone') ?? null,
      });
      return {
        ipv4: list((raw as Record<string, unknown>)?.ipv4).map(entry),
        ipv6: list((raw as Record<string, unknown>)?.ipv6).map(entry),
      };
    },
  },
  {
    id: 'rdns.set',
    name: 'Set reverse DNS',
    audience: 'client',
    paramsSchema: z.object({
      ipAddress: ipAddressSchema,
      hostname: z
        .string()
        .min(1)
        .max(253)
        .regex(/^[a-z0-9.-]+$/i, 'hostname')
        .transform((h) => h.replace(/\.$/, '')),
    }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      await clientFor(ctx, service.server).post(E.rdns, {
        productId: d.productId,
        ipAddress: params.ipAddress,
        hostname: params.hostname,
      });
      return { ok: true };
    },
  },
  {
    id: 'rdns.delete',
    name: 'Delete reverse DNS',
    audience: 'client',
    paramsSchema: z.object({ ipAddress: ipAddressSchema }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      await clientFor(ctx, service.server).delete(E.rdns, {
        productId: d.productId,
        ipAddress: params.ipAddress,
      });
      return { ok: true };
    },
  },
  {
    id: 'firewall.list',
    name: 'Firewall rules',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(E.firewall, {
        productId: d.productId,
      });
      return { rules: list((raw as Record<string, unknown>)?.rules) };
    },
  },
  {
    id: 'firewall.create',
    name: 'Add firewall rule',
    audience: 'client',
    paramsSchema: z.object({ rule: firewallRuleSchema }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).post(E.firewall, {
        productId: d.productId,
        action: 'create',
        rule: params.rule,
      });
    },
  },
  {
    id: 'firewall.edit',
    name: 'Edit firewall rule',
    audience: 'client',
    paramsSchema: z.object({ oldPos: z.number().int().min(0), rule: firewallRuleSchema }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).post(E.firewall, {
        productId: d.productId,
        action: 'edit',
        oldPos: params.oldPos,
        rule: params.rule,
      });
    },
  },
  {
    id: 'firewall.move',
    name: 'Move firewall rule',
    audience: 'client',
    paramsSchema: z.object({ oldPos: z.number().int().min(0), pos: z.number().int().min(0) }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).post(E.firewall, {
        productId: d.productId,
        action: 'move',
        oldPos: params.oldPos,
        pos: params.pos,
      });
    },
  },
  {
    id: 'firewall.delete',
    name: 'Delete firewall rule',
    audience: 'client',
    paramsSchema: z.object({ pos: z.number().int().min(0) }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      await clientFor(ctx, service.server).delete(E.firewall, {
        productId: d.productId,
        pos: params.pos,
      });
      return { ok: true };
    },
  },
  {
    id: 'ddos.stats',
    name: 'DDoS statistics',
    audience: 'client',
    readOnly: true,
    paramsSchema: z.object({
      ipAddress: ipAddressSchema,
      period: z.enum(['10m', '1h', '1d', '1w']).default('1h'),
    }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).get(E.ddos, {
        productId: d.productId,
        scope: 'stats',
        ipAddress: params.ipAddress,
        period: params.period,
      });
    },
  },
  {
    id: 'ddos.attacks',
    name: 'DDoS attacks',
    audience: 'client',
    readOnly: true,
    paramsSchema: z.object({ ipAddress: ipAddressSchema }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).get(E.ddos, {
        productId: d.productId,
        scope: 'attacks',
        ipAddress: params.ipAddress,
      });
    },
  },
  {
    id: 'statistics',
    name: 'Resource statistics',
    audience: 'client',
    readOnly: true,
    paramsSchema: z.object({ period: z.enum(['hour', 'day', 'week', 'month']).default('day') }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(E.statistic, {
        productId: d.productId,
        period: params.period,
      });
      return { statistics: list((raw as Record<string, unknown>)?.statistics) };
    },
  },
  {
    id: 'backup.list',
    name: 'Backups',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(E.backup, {
        productId: d.productId,
      });
      return { backups: list((raw as Record<string, unknown>)?.backups) };
    },
  },
  {
    id: 'backup.restore',
    name: 'Restore backup (overwrites the server)',
    audience: 'client',
    paramsSchema: z.object({ volid: z.string().min(1).max(255) }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      await clientFor(ctx, service.server).post(E.backup, {
        productId: d.productId,
        volid: params.volid,
      });
      return { ok: true };
    },
  },
  {
    id: 'os.list',
    name: 'Operating systems',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const raw = await clientFor(ctx, service.server).get<unknown>(E.os);
      return { images: list(raw).map(osOption) };
    },
  },
  {
    id: 'reinstall',
    name: 'Reinstall server (wipes all data)',
    audience: 'client',
    paramsSchema: z.object({
      osName: z.string().min(1).max(100),
      password: z.string().min(8).max(200).optional(),
    }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      const password = (params.password as string | undefined) ?? generatePassword();
      const raw = await clientFor(ctx, service.server).delete<unknown>(E.reinstall, {
        productId: d.productId,
        osName: params.osName,
        password,
      });
      Object.assign(service.moduleData, { osName: str(raw, 'osName') ?? params.osName });
      return {
        osName: str(raw, 'osName') ?? params.osName,
        newPassword: str(raw, 'password') ?? password,
      };
    },
  },
  {
    id: 'ip.add',
    name: 'Add IPv4 address (paid)',
    audience: 'staff',
    async run(ctx, service) {
      const d = dataOf(service);
      return clientFor(ctx, service.server).post(E.ip, { productId: d.productId });
    },
  },
  {
    id: 'product.log',
    name: 'Skrime product log',
    audience: 'staff',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const raw = await clientFor(ctx, service.server).get<unknown>(P.log, {
        productId: d.productId,
      });
      return { logs: list((raw as Record<string, unknown>)?.logs) };
    },
  },
];

/**
 * Resells Skrime KVM servers: one Provisia service = one server product in the reseller's Skrime account.
 * Power, console, reinstall, rDNS, firewall, backups and statistics are proxied to Skrime.
 */
export const skrimeServer = defineProvisioner({
  id: 'skrime_server',
  name: 'Skrime KVM Server (reseller)',
  version: '0.2.0',
  configSchema: skrimeServerConfigSchema,
  credentialsSchema: skrimeCredentialsSchema,
  extras,

  async testConnection(ctx: Ctx, server) {
    try {
      await clientFor(ctx, server).get(P.all, { type: 'server' });
      return { ok: true, message: 'Skrime API key accepted' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async listRemoteOptions(ctx: Ctx, server, kind): Promise<RemoteOption[]> {
    const api = clientFor(ctx, server);
    if (kind === 'plan')
      return list(await api.get<unknown>(E.pricelist, { type: 'server' })).map(serverPlanOption);
    if (kind === 'image') return list(await api.get<unknown>(E.os)).map(osOption);
    return [];
  },

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const api = clientFor(ctx, service.server);
    const hostname = hostnameFor(ctx, service);
    const password = service.password ?? generatePassword();
    const raw = await api.post<unknown>(E.order, orderBody(ctx, password));
    const productId = str(raw, 'id');
    if (!productId)
      throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a product id');
    const info = rec(raw, 'productInfo') ?? {};
    if (ctx.config.renewal === 'autorenew') await setAutoRenew(api, ctx, productId, true);
    await nameProduct(api, ctx, productId, hostname);
    let ipv4: string | undefined;
    let ipv6: string | undefined;
    try {
      const details = parseInformation(
        await api.get<unknown>(E.information, { productId, lazy: true }),
      );
      ipv4 = details.ipv4;
      ipv6 = details.ipv6;
    } catch (err) {
      ctx.logger.warn(
        { err, productId },
        'skrime server read-back failed; ip is picked up by the usage sync',
      );
    }
    const moduleData: SkrimeServerData = {
      productId,
      planId: ctx.config.planId,
      osName: ctx.config.osName,
      hostname,
      cores: num(info, 'cores'),
      memoryMb: num(info, 'memory'),
      diskGb: num(info, 'disk'),
      ipv4,
      ipv6,
      costAmount: recurringCents(raw),
      costCurrency: recurringCents(raw) !== undefined ? 'EUR' : undefined,
      expireAt: str(raw, 'expireAt'),
    };
    ctx.logger.info(
      { productId, hostname, ipv4, state: str(raw, 'state') },
      'Skrime server ordered',
    );
    return {
      moduleData: Object.fromEntries(Object.entries(moduleData).filter(([, v]) => v !== undefined)),
      username: 'root',
      password: str(info, 'password') ?? password,
      ipAddress: ipv4,
      message: `Skrime server ${productId} ordered (${hostname}${ipv4 ? `, ${ipv4}` : ', installing'})`,
    };
  },

  async suspend(ctx: Ctx, service) {
    if (ctx.config.suspendMode === 'none') return;
    await powerOp(ctx, service, 'stop');
  },

  async unsuspend(ctx: Ctx, service) {
    if (ctx.config.suspendMode === 'none') return;
    await powerOp(ctx, service, 'start');
  },

  /** No cancel call at Skrime: switch auto renewal off so the product expires at the end of the paid term. */
  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    const api = clientFor(ctx, service.server);
    try {
      await api.post(P.autorenew, { productId: d.productId, autoRenew: false });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    try {
      await api.post(E.action, { productId: d.productId, action: 'stop' });
    } catch (err) {
      ctx.logger.warn({ err, productId: d.productId }, 'terminate: could not stop the server');
    }
    Object.assign(service.moduleData, { cancelledAt: new Date().toISOString() });
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    await clientFor(ctx, service.server).post(E.passwd, { productId: d.productId, password });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const p = parseInformation(
      await clientFor(ctx, service.server).get<unknown>(E.information, { productId: d.productId }),
    );
    if (p.ipv4 && p.ipv4 !== d.ipv4) Object.assign(service.moduleData, { ipv4: p.ipv4 });
    if (p.ipv6 && p.ipv6 !== d.ipv6) Object.assign(service.moduleData, { ipv6: p.ipv6 });
    const extra: NonNullable<UsageInfo['extra']> = { status: p.powerState };
    if (p.cpuPercent !== undefined) extra.cpuPercent = p.cpuPercent;
    if (p.memoryUsedGb !== undefined) extra.memoryUsedMb = Math.round(p.memoryUsedGb * 1024);
    if (d.memoryMb !== undefined) extra.memoryLimitMb = d.memoryMb;
    if (p.os) extra.os = p.os;
    if (p.ipv4) extra.ip = p.ipv4;
    return {
      diskUsedMb: p.diskUsedGb !== undefined ? Math.round(p.diskUsedGb * 1024) : undefined,
      diskLimitMb: d.diskGb !== undefined ? d.diskGb * 1024 : undefined,
      extra,
    };
  },

  /** The "panel" of a KVM server is its noVNC console. */
  async loginUrl(ctx: Ctx, service): Promise<string> {
    const d = dataOf(service);
    const raw = await clientFor(ctx, service.server).get<unknown>(E.novnc, {
      productId: d.productId,
    });
    const url = str(raw, 'url');
    if (!url)
      throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a console URL');
    return url;
  },

  /** Skrime only knows start/stop: shutdown = stop, reboot = stop followed by start. */
  async power(ctx: Ctx, service, action: PowerAction) {
    if (action === 'start' || action === 'stop') return powerOp(ctx, service, action);
    if (action === 'shutdown') return powerOp(ctx, service, 'stop');
    await powerOp(ctx, service, 'stop');
    await powerOp(ctx, service, 'start');
  },
});

import {
  defineProvisioner,
  type ModuleContext,
  type PowerAction,
  type ProvisionResult,
  type RemoteOption,
  type ServiceDTO,
  type UsageInfo,
} from '@provisia/module-sdk';
import { generatePassword } from '@provisia/shared';
import {
  asList,
  clientFor,
  eurosToCents,
  isNotFound,
  normaliseStatus,
  pickNumber,
  pickString,
  SkrimeProvisionError,
  toRemoteOption,
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

/** Skrime power verbs for the SDK's actions. */
const POWER_ACTION: Record<PowerAction, string> = {
  start: 'start',
  stop: 'stop',
  shutdown: 'shutdown',
  reboot: 'restart',
};

function dataOf(service: ServiceDTO): SkrimeServerData {
  const d = service.moduleData as Partial<SkrimeServerData>;
  if (!d.productId) {
    throw new SkrimeProvisionError('not_provisioned', 'Service has no Skrime server assigned');
  }
  return d as SkrimeServerData;
}

function parseServer(raw: unknown) {
  const power = pickString(raw, ['power', 'powerState', 'power_state', 'vmStatus']);
  return {
    id: pickString(raw, ['id', 'productId', 'product_id', 'serverId']),
    status: normaliseStatus(pickString(raw, ['status', 'state'])),
    powerState: power ? power.toLowerCase() : undefined,
    ip: pickString(raw, ['ip', 'ipv4', 'ipAddress', 'ip_address', 'mainIp']),
    hostname: pickString(raw, ['hostname', 'name']),
    password: pickString(raw, ['password', 'rootPassword']),
    priceEur: pickNumber(raw, ['price', 'monthly', 'priceMonthly']),
    cpu: pickNumber(raw, ['cpu', 'cores', 'vcpu']),
    ramMb: pickNumber(raw, ['ramMb', 'ram', 'memory']),
    diskGb: pickNumber(raw, ['diskGb', 'disk', 'storage']),
    trafficUsedMb: pickNumber(raw, ['trafficUsedMb', 'trafficUsed', 'bandwidthUsed']),
    trafficLimitMb: pickNumber(raw, ['trafficLimitMb', 'trafficLimit', 'traffic', 'bandwidth']),
  };
}

function hostnameFor(ctx: Ctx, service: ServiceDTO): string {
  if (service.domain) return service.domain.toLowerCase();
  return `${ctx.config.hostnamePrefix}${service.id.replace(/-/g, '').slice(-8)}`.toLowerCase();
}

/**
 * Resells Skrime KVM servers: one Provisia service = one server product in the reseller's Skrime
 * account. Power control, reinstall and root password reset are proxied to Skrime.
 */
export const skrimeServer = defineProvisioner({
  id: 'skrime_server',
  name: 'Skrime KVM Server (reseller)',
  version: '0.1.0',
  configSchema: skrimeServerConfigSchema,
  credentialsSchema: skrimeCredentialsSchema,

  async testConnection(ctx: Ctx, server) {
    try {
      await clientFor(ctx, server).get(SKRIME_ENDPOINTS.productList);
      return { ok: true, message: 'Skrime API key accepted' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async listRemoteOptions(ctx: Ctx, server, kind): Promise<RemoteOption[]> {
    if (kind === 'plan')
      return asList(await clientFor(ctx, server).get<unknown>(E.plans)).map(toRemoteOption);
    if (kind === 'image')
      return asList(await clientFor(ctx, server).get<unknown>(E.images)).map(toRemoteOption);
    return [];
  },

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const api = clientFor(ctx, service.server);
    const hostname = hostnameFor(ctx, service);
    const password = service.password ?? generatePassword();
    const raw = await api.post<unknown>(E.order, {
      plan: ctx.config.plan,
      image: ctx.config.image,
      hostname,
      password,
      tos: true,
    });
    const parsed = parseServer(raw);
    if (!parsed.id) {
      throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a server id');
    }
    let ip = parsed.ip;
    let priceEur = parsed.priceEur;
    if (!ip) {
      try {
        const details = parseServer(await api.get<unknown>(E.single, { id: parsed.id }));
        ip = details.ip;
        priceEur ??= details.priceEur;
      } catch (err) {
        ctx.logger.warn({ err, id: parsed.id }, 'skrime server read-back failed; ip unknown yet');
      }
    }
    const moduleData: SkrimeServerData = {
      productId: parsed.id,
      plan: ctx.config.plan,
      image: ctx.config.image,
      hostname,
      ...(ip ? { ip } : {}),
      ...(priceEur !== undefined
        ? { costAmount: eurosToCents(priceEur), costCurrency: 'EUR' }
        : {}),
    };
    ctx.logger.info({ id: parsed.id, hostname, ip }, 'Skrime server ordered');
    return {
      moduleData: { ...moduleData },
      username: 'root',
      password: parsed.password ?? password,
      ipAddress: ip,
      message: `Skrime server ${parsed.id} ordered (${hostname}${ip ? `, ${ip}` : ''})`,
    };
  },

  async suspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    await clientFor(ctx, service.server).post(E.power, {
      id: d.productId,
      action: POWER_ACTION.stop,
    });
  },

  async unsuspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    await clientFor(ctx, service.server).post(E.power, {
      id: d.productId,
      action: POWER_ACTION.start,
    });
  },

  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    try {
      await clientFor(ctx, service.server).post(E.cancel, { id: d.productId });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    Object.assign(service.moduleData, { cancelledAt: new Date().toISOString() });
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const d = dataOf(service);
    const next = skrimeServerConfigSchema.parse(newProduct.moduleConfig);
    if (next.plan === d.plan) return;
    await clientFor(ctx, service.server).post(E.upgrade, { id: d.productId, plan: next.plan });
    Object.assign(service.moduleData, { plan: next.plan });
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    await clientFor(ctx, service.server).post(E.password, { id: d.productId, password });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const p = parseServer(
      await clientFor(ctx, service.server).get<unknown>(E.single, { id: d.productId }),
    );
    if (p.ip && p.ip !== d.ip) Object.assign(service.moduleData, { ip: p.ip });
    const extra: NonNullable<UsageInfo['extra']> = { status: p.powerState ?? p.status };
    if (p.cpu !== undefined) extra.cpu = p.cpu;
    if (p.ramMb !== undefined) extra.ramMb = p.ramMb;
    if (p.diskGb !== undefined) extra.diskGb = p.diskGb;
    if (p.ip) extra.ip = p.ip;
    return {
      bandwidthUsedMb: p.trafficUsedMb,
      bandwidthLimitMb: p.trafficLimitMb,
      diskLimitMb: p.diskGb !== undefined ? p.diskGb * 1024 : undefined,
      extra,
    };
  },

  async power(ctx: Ctx, service, action) {
    const d = dataOf(service);
    await clientFor(ctx, service.server).post(E.power, {
      id: d.productId,
      action: POWER_ACTION[action],
    });
  },
});

/** Reinstalls the server with the product's image (admin action; not part of the SDK contract). */
export async function reinstallSkrimeServer(
  ctx: ModuleContext<unknown>,
  service: ServiceDTO,
  image?: string,
) {
  const d = dataOf(service);
  const password = generatePassword();
  await clientFor(ctx, service.server).post(E.reinstall, {
    id: d.productId,
    image: image ?? d.image,
    password,
  });
  return { password, image: image ?? d.image };
}

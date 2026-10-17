import {
  defineProvisioner,
  type ModuleContext,
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
  type SkrimeWebspaceConfig,
  type SkrimeWebspaceData,
  skrimeCredentialsSchema,
  skrimeWebspaceConfigSchema,
} from './config.js';
import { SKRIME_ENDPOINTS } from './endpoints.js';

type Ctx = ModuleContext<SkrimeWebspaceConfig>;
type Rec = Record<string, unknown>;
const E = SKRIME_ENDPOINTS.webspace;

function dataOf(service: ServiceDTO): SkrimeWebspaceData {
  const d = service.moduleData as Partial<SkrimeWebspaceData>;
  if (!d.productId) {
    throw new SkrimeProvisionError('not_provisioned', 'Service has no Skrime webspace assigned');
  }
  return d as SkrimeWebspaceData;
}

/** Reads the fields we care about from a `webspace/single` / `webspace/order` payload. */
function parseWebspace(raw: unknown) {
  const panel = (raw && typeof raw === 'object' ? (raw as Rec).panel : undefined) as
    | Rec
    | undefined;
  const login = (raw && typeof raw === 'object' ? (raw as Rec).login : undefined) as
    | Rec
    | undefined;
  return {
    id: pickString(raw, ['id', 'productId', 'product_id', 'webspaceId']),
    status: normaliseStatus(pickString(raw, ['status', 'state'])),
    domain: pickString(raw, ['domain', 'name']),
    panelUrl:
      pickString(panel, ['url', 'loginUrl']) ??
      pickString(login, ['url']) ??
      pickString(raw, ['panelUrl', 'pleskUrl', 'loginUrl', 'url']),
    username:
      pickString(panel, ['username', 'user', 'login']) ??
      pickString(login, ['username', 'user']) ??
      pickString(raw, ['username', 'user', 'login']),
    password: pickString(panel, ['password']) ?? pickString(raw, ['password']),
    priceEur: pickNumber(raw, ['price', 'monthly', 'priceMonthly']),
    diskUsedMb: pickNumber(raw, ['diskUsedMb', 'diskUsed', 'storageUsed', 'usedSpace']),
    diskLimitMb: pickNumber(raw, ['diskLimitMb', 'diskLimit', 'storage', 'space', 'disk']),
    trafficUsedMb: pickNumber(raw, ['trafficUsedMb', 'trafficUsed', 'bandwidthUsed']),
    trafficLimitMb: pickNumber(raw, ['trafficLimitMb', 'trafficLimit', 'traffic', 'bandwidth']),
  };
}

/**
 * Resells Skrime webspace (Plesk based) packages: each Provisia service maps to one webspace product
 * in the reseller's Skrime account. Skrime bills the reseller; Provisia bills the client.
 */
export const skrimeWebspace = defineProvisioner({
  id: 'skrime_webspace',
  name: 'Skrime Webspace (reseller)',
  version: '0.1.0',
  configSchema: skrimeWebspaceConfigSchema,
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
    if (kind !== 'package') return [];
    const data = await clientFor(ctx, server).get<unknown>(E.packages);
    return asList(data).map(toRemoteOption);
  },

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const api = clientFor(ctx, service.server);
    if (!service.domain) {
      throw new SkrimeProvisionError('domain_required', 'Skrime webspace needs a domain name');
    }
    const domain = service.domain.toLowerCase();
    const raw = await api.post<unknown>(E.order, {
      package: ctx.config.package,
      domain,
      tos: true,
    });
    const parsed = parseWebspace(raw);
    if (!parsed.id) {
      throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a webspace id');
    }
    // The order response may be thin; read the product back for panel details when it has none.
    let details = parsed;
    if (!parsed.panelUrl || !parsed.username) {
      try {
        details = {
          ...parsed,
          ...stripUndefined(parseWebspace(await api.get<unknown>(E.single, { id: parsed.id }))),
        };
      } catch (err) {
        ctx.logger.warn(
          { err, id: parsed.id },
          'skrime webspace read-back failed; keeping order data',
        );
      }
    }
    let password = details.password ?? service.password;
    if (!password) {
      // Skrime generated a password we cannot read: set our own so the client can log in.
      password = generatePassword();
      await api.post(E.password, { id: parsed.id, password });
    }
    const moduleData: SkrimeWebspaceData = {
      productId: parsed.id,
      package: ctx.config.package,
      domain,
      panelUrl: details.panelUrl,
      username: details.username,
      costAmount: eurosToCents(details.priceEur),
      costCurrency: details.priceEur !== undefined ? 'EUR' : undefined,
    };
    ctx.logger.info({ id: parsed.id, domain }, 'Skrime webspace ordered');
    return {
      moduleData: stripUndefined(moduleData) as unknown as Record<string, unknown>,
      username: details.username,
      password,
      message: `Skrime webspace ${parsed.id} ordered for ${domain}`,
    };
  },

  async suspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    // No suspend endpoint: lock the client out of the panel by rotating the password.
    await clientFor(ctx, service.server).post(E.password, {
      id: d.productId,
      password: generatePassword(24),
    });
  },

  async unsuspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    const password = service.password ?? generatePassword();
    await clientFor(ctx, service.server).post(E.password, { id: d.productId, password });
    if (!service.password) {
      ctx.logger.warn(
        { id: d.productId },
        'unsuspend: stored password unknown; client must reset the panel password',
      );
    }
  },

  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    try {
      await clientFor(ctx, service.server).post(E.cancel, { id: d.productId });
    } catch (err) {
      if (isNotFound(err)) return; // already gone at Skrime
      throw err;
    }
    Object.assign(service.moduleData, { cancelledAt: new Date().toISOString() });
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const d = dataOf(service);
    const next = skrimeWebspaceConfigSchema.parse(newProduct.moduleConfig);
    if (next.package === d.package) return;
    await clientFor(ctx, service.server).post(E.upgrade, {
      id: d.productId,
      package: next.package,
    });
    Object.assign(service.moduleData, { package: next.package });
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    await clientFor(ctx, service.server).post(E.password, { id: d.productId, password });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const p = parseWebspace(
      await clientFor(ctx, service.server).get<unknown>(E.single, { id: d.productId }),
    );
    return {
      diskUsedMb: p.diskUsedMb,
      diskLimitMb: p.diskLimitMb,
      bandwidthUsedMb: p.trafficUsedMb,
      bandwidthLimitMb: p.trafficLimitMb,
      extra: { status: p.status },
    };
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const d = dataOf(service);
    try {
      const raw = await clientFor(ctx, service.server).get<unknown>(E.login, { id: d.productId });
      const url = pickString(raw, ['url', 'loginUrl', 'link']);
      if (url) return url;
    } catch (err) {
      ctx.logger.warn({ err, id: d.productId }, 'skrime one-time login failed; using panel url');
    }
    if (d.panelUrl) return d.panelUrl;
    throw new SkrimeProvisionError('no_login_url', 'Skrime did not provide a panel login URL');
  },
});

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

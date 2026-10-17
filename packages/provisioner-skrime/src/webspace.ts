import {
  defineProvisioner,
  type ModuleContext,
  type ModuleExtraAction,
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
  rec,
  recurringCents,
  SkrimeProvisionError,
  setAutoRenew,
  str,
  webspacePlanOption,
} from './client.js';
import {
  type SkrimeWebspaceConfig,
  type SkrimeWebspaceData,
  skrimeCredentialsSchema,
  skrimeWebspaceConfigSchema,
} from './config.js';
import { SKRIME_ENDPOINTS } from './endpoints.js';

type Ctx = ModuleContext<SkrimeWebspaceConfig>;
const E = SKRIME_ENDPOINTS.webspace;
const P = SKRIME_ENDPOINTS.product;

function dataOf(service: ServiceDTO): SkrimeWebspaceData {
  const d = service.moduleData as Partial<SkrimeWebspaceData>;
  if (!d.productId) {
    throw new SkrimeProvisionError('not_provisioned', 'Service has no Skrime webspace assigned');
  }
  return d as SkrimeWebspaceData;
}

/** `GET webspace/information` → the fields we keep. */
function parseInformation(raw: unknown) {
  const disk = rec(raw, 'disk');
  return {
    panelHost: str(raw, 'domain'),
    ipv4: str(raw, 'ipv4'),
    ipv6: str(raw, 'ipv6'),
    username: str(raw, 'username'),
    password: str(raw, 'password'),
    diskUsedMb: num(disk, 'used'),
    diskLimitMb: num(disk, 'limit'),
  };
}

const extras: ModuleExtraAction[] = [
  {
    id: 'info',
    name: 'Panel details',
    audience: 'client',
    readOnly: true,
    async run(ctx, service) {
      const d = dataOf(service);
      const info = parseInformation(
        await clientFor(ctx, service.server).get<unknown>(E.information, {
          productId: d.productId,
        }),
      );
      return {
        panelHost: info.panelHost ?? d.panelHost ?? null,
        username: info.username ?? d.username ?? null,
        ipv4: info.ipv4 ?? null,
        ipv6: info.ipv6 ?? null,
        diskUsedMb: info.diskUsedMb ?? null,
        diskLimitMb: info.diskLimitMb ?? null,
      };
    },
  },
  {
    id: 'reinstall',
    name: 'Reinstall webspace (wipes all data)',
    audience: 'client',
    paramsSchema: z.object({ password: z.string().min(8).max(200).optional() }),
    async run(ctx, service, params) {
      const d = dataOf(service);
      const password = (params.password as string | undefined) ?? generatePassword();
      const raw = await clientFor(ctx, service.server).delete<unknown>(E.reinstall, {
        productId: d.productId,
        password,
      });
      return {
        username: str(raw, 'username') ?? d.username ?? null,
        newPassword: str(raw, 'password') ?? password,
      };
    },
  },
];

/**
 * Resells Skrime webspace (Plesk) plans: one Provisia service = one webspace product in the reseller's
 * Skrime account. Skrime bills the reseller; Provisia bills the client. The client attaches domains in
 * the Plesk panel (SSO via `loginUrl`).
 */
export const skrimeWebspace = defineProvisioner({
  id: 'skrime_webspace',
  name: 'Skrime Webspace (reseller)',
  version: '0.2.0',
  configSchema: skrimeWebspaceConfigSchema,
  credentialsSchema: skrimeCredentialsSchema,
  extras,

  async testConnection(ctx: Ctx, server) {
    try {
      await clientFor(ctx, server).get(P.all, { type: 'webspace' });
      return { ok: true, message: 'Skrime API key accepted' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async listRemoteOptions(ctx: Ctx, server, kind): Promise<RemoteOption[]> {
    if (kind !== 'plan') return [];
    return list(await clientFor(ctx, server).get<unknown>(E.pricelist)).map(webspacePlanOption);
  },

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const api = clientFor(ctx, service.server);
    const raw = await api.post<unknown>(E.order, {
      planId: ctx.config.planId,
      tos: true,
      cancellation: true,
    });
    const productId = str(raw, 'id');
    if (!productId)
      throw new SkrimeProvisionError('invalid_response', 'Skrime did not return a product id');
    const info = rec(raw, 'productInfo') ?? {};
    let username = str(info, 'username');
    let password = str(info, 'password');
    let panelHost: string | undefined;
    let ipv4: string | undefined;
    let ipv6: string | undefined;
    try {
      const details = parseInformation(await api.get<unknown>(E.information, { productId }));
      username ??= details.username;
      password ??= details.password;
      panelHost = details.panelHost;
      ipv4 = details.ipv4;
      ipv6 = details.ipv6;
    } catch (err) {
      ctx.logger.warn({ err, productId }, 'skrime webspace read-back failed; keeping order data');
    }
    if (!password) {
      // Not readable: set our own so the client can log in.
      password = service.password ?? generatePassword();
      await api.post(E.passwd, { productId, password });
    }
    if (ctx.config.renewal === 'autorenew') await setAutoRenew(api, ctx, productId, true);
    await nameProduct(api, ctx, productId, service.domain ?? service.client.name);
    const moduleData: SkrimeWebspaceData = {
      productId,
      planId: ctx.config.planId,
      planName: str(info, 'plan_id'),
      panelHost,
      username,
      ipv4,
      ipv6,
      costAmount: recurringCents(raw),
      costCurrency: recurringCents(raw) !== undefined ? 'EUR' : undefined,
      expireAt: str(raw, 'expireAt'),
    };
    ctx.logger.info({ productId, panelHost }, 'Skrime webspace ordered');
    return {
      moduleData: stripUndefined(moduleData),
      username,
      password,
      ipAddress: ipv4,
      message: `Skrime webspace ${productId} ordered (${str(info, 'plan_id') ?? ctx.config.planId})`,
    };
  },

  async suspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    await clientFor(ctx, service.server).post(E.passwd, {
      productId: d.productId,
      password: generatePassword(24),
    });
  },

  async unsuspend(ctx: Ctx, service) {
    const d = dataOf(service);
    if (ctx.config.suspendMode === 'none') return;
    const password = service.password ?? generatePassword();
    await clientFor(ctx, service.server).post(E.passwd, { productId: d.productId, password });
    if (!service.password) {
      ctx.logger.warn(
        { productId: d.productId },
        'unsuspend: stored password unknown; client must reset it',
      );
    }
  },

  /** Skrime has no cancel call: switch auto renewal off so the product expires at the end of the paid term. */
  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    const api = clientFor(ctx, service.server);
    try {
      await api.post(P.autorenew, { productId: d.productId, autoRenew: false });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    Object.assign(service.moduleData, { cancelledAt: new Date().toISOString() });
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const d = dataOf(service);
    const next = skrimeWebspaceConfigSchema.parse(newProduct.moduleConfig);
    if (next.planId === d.planId) return;
    const raw = await clientFor(ctx, service.server).post<unknown>(E.upgrade, {
      productId: d.productId,
      planId: next.planId,
    });
    Object.assign(service.moduleData, {
      planId: next.planId,
      planName: str(rec(raw, 'productInfo'), 'plan_id') ?? d.planName,
      costAmount: recurringCents(raw) ?? d.costAmount,
    });
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    await clientFor(ctx, service.server).post(E.passwd, { productId: d.productId, password });
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const info = parseInformation(
      await clientFor(ctx, service.server).get<unknown>(E.information, { productId: d.productId }),
    );
    if (info.ipv4 && info.ipv4 !== d.ipv4) Object.assign(service.moduleData, { ipv4: info.ipv4 });
    return {
      diskUsedMb: info.diskUsedMb,
      diskLimitMb: info.diskLimitMb,
      extra: { status: 'active', ...(info.panelHost ? { panelHost: info.panelHost } : {}) },
    };
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const d = dataOf(service);
    const raw = await clientFor(ctx, service.server).get<unknown>(E.login, {
      productId: d.productId,
    });
    const url = str(raw, 'loginUrl') ?? str(raw, 'url');
    if (url) return url;
    if (d.panelHost) return `https://${d.panelHost}`;
    throw new SkrimeProvisionError('no_login_url', 'Skrime did not provide a panel login URL');
  },
});

function stripUndefined<T extends object>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

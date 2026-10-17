import {
  defineProvisioner,
  type ModuleContext,
  type PowerAction,
  type ProvisionResult,
  type RemoteOption,
  type ServerDTO,
  type ServiceDTO,
  type UsageInfo,
} from '@provisia/module-sdk';
import { generatePassword } from '@provisia/shared';
import { bytesToMb, ProxmoxClient, ProxmoxError, staticIpOf } from './client.js';
import {
  type ProxmoxConfig,
  type ProxmoxCredentials,
  type ProxmoxModuleData,
  proxmoxConfigSchema,
  proxmoxCredentialsSchema,
} from './config.js';

export { ProxmoxClient, ProxmoxError } from './client.js';
export * from './config.js';

type Ctx = ModuleContext<ProxmoxConfig>;

interface GuestStatus {
  status: 'running' | 'stopped' | 'paused' | string;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  uptime?: number;
  lock?: string;
  name?: string;
}

function client(ctx: ModuleContext<unknown>, server: ServerDTO | null) {
  if (!server) throw new ProxmoxError('no_server', 'Service has no server assigned');
  const creds = proxmoxCredentialsSchema.parse(ctx.credentials) as ProxmoxCredentials;
  return { api: new ProxmoxClient(ctx.fetch, server, creds), creds };
}

function dataOf(service: ServiceDTO): ProxmoxModuleData {
  const d = service.moduleData as Partial<ProxmoxModuleData>;
  if (!d.vmid || !d.node || !d.type) {
    throw new ProxmoxError('not_provisioned', 'Service has no Proxmox VM assigned');
  }
  return d as ProxmoxModuleData;
}

const guestPath = (d: Pick<ProxmoxModuleData, 'node' | 'type' | 'vmid'>) =>
  `/nodes/${encodeURIComponent(d.node)}/${d.type}/${d.vmid}`;

async function resolveNode(
  api: ProxmoxClient,
  configNode: string | undefined,
  creds: ProxmoxCredentials,
): Promise<string> {
  if (configNode) return configNode;
  if (creds.node) return creds.node;
  const nodes = await api.get<Array<{ node: string; status?: string }>>('/nodes');
  const online = nodes.find((n) => n.status === 'online') ?? nodes[0];
  if (!online) throw new ProxmoxError('no_node', 'Proxmox cluster has no nodes');
  return online.node;
}

const timeouts = (cfg: ProxmoxConfig) => ({
  timeoutMs: cfg.taskTimeoutSeconds * 1000,
  pollMs: cfg.taskPollMs,
});

async function currentStatus(api: ProxmoxClient, d: ProxmoxModuleData): Promise<GuestStatus> {
  return api.get<GuestStatus>(`${guestPath(d)}/status/current`);
}

async function powerOp(
  api: ProxmoxClient,
  cfg: ProxmoxConfig,
  d: ProxmoxModuleData,
  action: PowerAction,
  extra: Record<string, string | number | boolean> = {},
) {
  const { timeoutMs, pollMs } = timeouts(cfg);
  const upid = await api.post(`${guestPath(d)}/status/${action}`, extra);
  await api.waitTask(d.node, upid, timeoutMs, pollMs);
}

async function ensureStopped(api: ProxmoxClient, cfg: ProxmoxConfig, d: ProxmoxModuleData) {
  const st = await currentStatus(api, d);
  if (st.status !== 'stopped') {
    await powerOp(api, cfg, d, 'stop', d.type === 'qemu' ? { skiplock: 1 } : {});
  }
}

function netConfig(cfg: ProxmoxConfig, type: 'qemu' | 'lxc'): string {
  const tag = cfg.vlanTag ? `,tag=${cfg.vlanTag}` : '';
  if (type === 'qemu') return `virtio,bridge=${cfg.bridge}${tag}`;
  return `name=eth0,bridge=${cfg.bridge},${cfg.ipConfig}${tag}`;
}

const proxmox = defineProvisioner({
  id: 'proxmox',
  name: 'Proxmox VE',
  version: '1.0.0',
  configSchema: proxmoxConfigSchema,
  credentialsSchema: proxmoxCredentialsSchema,

  async create(ctx: Ctx, service): Promise<ProvisionResult> {
    const cfg = ctx.config;
    const { api, creds } = client(ctx, service.server);
    const { timeoutMs, pollMs } = timeouts(cfg);
    const node = await resolveNode(api, cfg.node, creds);
    const vmid = Number(await api.get<string | number>('/cluster/nextid'));
    if (!Number.isInteger(vmid)) throw new ProxmoxError('no_vmid', 'Could not allocate a VMID');
    const password = service.password ?? generatePassword();
    const name = (service.domain ?? `${cfg.hostnamePrefix}${vmid}`).toLowerCase();
    const d: ProxmoxModuleData = { vmid, node, type: cfg.type, name, diskGb: cfg.diskGb };

    if (cfg.type === 'qemu') {
      const templateVmid = Number(cfg.template);
      if (!Number.isInteger(templateVmid)) {
        throw new ProxmoxError('bad_template', 'qemu template must be the VMID of a template');
      }
      const clone = await api.post(`/nodes/${node}/qemu/${templateVmid}/clone`, {
        newid: vmid,
        name,
        full: cfg.fullClone,
        storage: cfg.fullClone ? cfg.storage : undefined,
        target: node,
      });
      await api.waitTask(node, clone, timeoutMs, pollMs);
      await api.post(`${guestPath(d)}/config`, {
        cores: cfg.cores,
        memory: cfg.memoryMb,
        net0: netConfig(cfg, 'qemu'),
        ipconfig0: cfg.ipConfig,
        nameserver: cfg.nameserver,
        ciuser: cfg.ciUser,
        cipassword: password,
        sshkeys: cfg.sshKeys ? encodeURIComponent(cfg.sshKeys) : undefined,
        onboot: cfg.onboot,
      });
      d.bootDisk = cfg.bootDisk;
      const resize = await api.put(`${guestPath(d)}/resize`, {
        disk: cfg.bootDisk,
        size: `${cfg.diskGb}G`,
      });
      await api.waitTask(node, resize, timeoutMs, pollMs);
    } else {
      const create = await api.post(`/nodes/${node}/lxc`, {
        vmid,
        ostemplate: cfg.template,
        hostname: name,
        password,
        cores: cfg.cores,
        memory: cfg.memoryMb,
        swap: cfg.swapMb,
        rootfs: `${cfg.storage ?? 'local-lvm'}:${cfg.diskGb}`,
        net0: netConfig(cfg, 'lxc'),
        nameserver: cfg.nameserver,
        'ssh-public-keys': cfg.sshKeys,
        unprivileged: cfg.unprivileged,
        onboot: cfg.onboot,
      });
      await api.waitTask(node, create, timeoutMs, pollMs);
    }
    if (cfg.startAfterCreate) await powerOp(api, cfg, d, 'start');
    const ip = staticIpOf(cfg.ipConfig);
    if (ip) d.ip = ip;
    ctx.logger.info({ vmid, node, type: cfg.type }, 'Proxmox guest created');
    return {
      moduleData: { ...d },
      username: cfg.type === 'qemu' ? cfg.ciUser : 'root',
      password,
      ipAddress: ip,
      message: `${cfg.type === 'qemu' ? 'VM' : 'Container'} ${vmid} created on ${node}`,
    };
  },

  async suspend(ctx: Ctx, service) {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    await ensureStopped(api, ctx.config, d);
    if (d.type === 'qemu') await api.post(`${guestPath(d)}/config`, { lock: 'suspended' });
    else await api.put(`${guestPath(d)}/config`, { protection: 1 });
  },

  async unsuspend(ctx: Ctx, service) {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    if (d.type === 'qemu')
      await api.post(`${guestPath(d)}/config`, { delete: 'lock', skiplock: 1 });
    else await api.put(`${guestPath(d)}/config`, { protection: 0 });
    await powerOp(api, ctx.config, d, 'start');
  },

  async terminate(ctx: Ctx, service) {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    const { timeoutMs, pollMs } = timeouts(ctx.config);
    try {
      await ensureStopped(api, ctx.config, d);
    } catch (err) {
      if (err instanceof ProxmoxError && err.code === 'not_found') return; // already gone
      throw err;
    }
    if (d.type === 'lxc') await api.put(`${guestPath(d)}/config`, { protection: 0 });
    const upid = await api.delete(guestPath(d), {
      purge: 1,
      ...(d.type === 'qemu' ? { 'destroy-unreferenced-disks': 1, skiplock: 1 } : { force: 1 }),
    });
    await api.waitTask(d.node, upid, timeoutMs, pollMs);
  },

  async changePackage(ctx: Ctx, service, newProduct) {
    const d = dataOf(service);
    const next = proxmoxConfigSchema.parse(newProduct.moduleConfig);
    if (next.type !== d.type) {
      throw new ProxmoxError('type_mismatch', `Cannot change a ${d.type} guest into ${next.type}`);
    }
    const { api } = client(ctx, service.server);
    const { timeoutMs, pollMs } = timeouts(next);
    const resources = { cores: next.cores, memory: next.memoryMb };
    if (d.type === 'qemu') await api.post(`${guestPath(d)}/config`, resources);
    else await api.put(`${guestPath(d)}/config`, { ...resources, swap: next.swapMb });
    if (next.diskGb > d.diskGb) {
      const upid = await api.put(`${guestPath(d)}/resize`, {
        disk: d.type === 'qemu' ? (d.bootDisk ?? next.bootDisk) : 'rootfs',
        size: `${next.diskGb}G`,
      });
      await api.waitTask(d.node, upid, timeoutMs, pollMs);
      d.diskGb = next.diskGb;
    } else if (next.diskGb < d.diskGb) {
      ctx.logger.warn({ vmid: d.vmid }, 'Proxmox cannot shrink disks; keeping current size');
    }
    // Persisted by the worker from service.moduleData after the call.
    Object.assign(service.moduleData, { diskGb: d.diskGb });
  },

  async changePassword(ctx: Ctx, service, password) {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    if (d.type !== 'qemu') {
      throw new ProxmoxError(
        'not_supported',
        'Proxmox has no API to change the root password of an existing container; use the console',
      );
    }
    await api.post(`${guestPath(d)}/config`, { cipassword: password });
    ctx.logger.info({ vmid: d.vmid }, 'cloud-init password updated; applies on next boot');
  },

  async getUsage(ctx: Ctx, service): Promise<UsageInfo> {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    const st = await currentStatus(api, d);
    return {
      diskUsedMb: bytesToMb(st.disk),
      diskLimitMb: bytesToMb(st.maxdisk),
      bandwidthUsedMb: bytesToMb((st.netin ?? 0) + (st.netout ?? 0)),
      extra: {
        status: st.status,
        cpuPercent: Math.round((st.cpu ?? 0) * 1000) / 10,
        cpus: st.cpus ?? 0,
        memUsedMb: bytesToMb(st.mem),
        memLimitMb: bytesToMb(st.maxmem),
        netInMb: bytesToMb(st.netin),
        netOutMb: bytesToMb(st.netout),
        uptimeSeconds: st.uptime ?? 0,
      },
    };
  },

  async loginUrl(ctx: Ctx, service): Promise<string> {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    const q = new URLSearchParams({
      console: d.type === 'qemu' ? 'kvm' : 'lxc',
      novnc: '1',
      vmid: String(d.vmid),
      vmname: d.name,
      node: d.node,
      resize: 'off',
    });
    return `${api.baseUrl}/?${q}`;
  },

  async power(ctx: Ctx, service, action) {
    const d = dataOf(service);
    const { api } = client(ctx, service.server);
    const st = await currentStatus(api, d);
    if (st.lock === 'suspended') {
      throw new ProxmoxError('locked', 'Guest is suspended');
    }
    if (action === 'start' && st.status === 'running') return;
    if ((action === 'stop' || action === 'shutdown') && st.status === 'stopped') return;
    if (action === 'reboot' && st.status === 'stopped') {
      await powerOp(api, ctx.config, d, 'start');
      return;
    }
    await powerOp(api, ctx.config, d, action);
  },

  async testConnection(ctx, server) {
    try {
      const { api } = client(ctx, server);
      const v = await api.get<{ version?: string; release?: string }>('/version');
      return { ok: true, message: `Proxmox VE ${v.version ?? v.release ?? ''}`.trim() };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async listRemoteOptions(ctx, server, kind): Promise<RemoteOption[]> {
    const { api, creds } = client(ctx, server);
    const cfg = (ctx.config ?? {}) as Partial<ProxmoxConfig>;
    if (kind === 'nodes') {
      const nodes =
        await api.get<Array<{ node: string; status?: string; maxcpu?: number }>>('/nodes');
      return nodes.map((n) => ({
        id: n.node,
        name: n.node,
        extra: { status: n.status ?? null, cpus: n.maxcpu ?? null },
      }));
    }
    const node = await resolveNode(api, cfg.node, creds);
    if (kind === 'templates') {
      const out: RemoteOption[] = [];
      const vms = await api.get<Array<{ vmid: number; name?: string; template?: number }>>(
        `/nodes/${node}/qemu`,
      );
      for (const vm of vms) {
        if (vm.template === 1) {
          out.push({
            id: String(vm.vmid),
            name: `${vm.name ?? 'template'} (VM ${vm.vmid})`,
            extra: { type: 'qemu', node },
          });
        }
      }
      const stores = await api.get<Array<{ storage: string }>>(`/nodes/${node}/storage`, {
        content: 'vztmpl',
      });
      for (const s of stores) {
        const items = await api.get<Array<{ volid: string; size?: number }>>(
          `/nodes/${node}/storage/${encodeURIComponent(s.storage)}/content`,
          { content: 'vztmpl' },
        );
        for (const t of items) {
          out.push({
            id: t.volid,
            name: t.volid.split('/').pop() ?? t.volid,
            extra: { type: 'lxc', node, storage: s.storage },
          });
        }
      }
      return out;
    }
    if (kind === 'storages') {
      const stores = await api.get<
        Array<{ storage: string; content?: string; avail?: number; type?: string }>
      >(`/nodes/${node}/storage`);
      return stores
        .filter((s) => /images|rootdir/.test(s.content ?? ''))
        .map((s) => ({
          id: s.storage,
          name: s.storage,
          extra: { type: s.type ?? null, availGb: Math.round((s.avail ?? 0) / 1024 ** 3) },
        }));
    }
    if (kind === 'bridges') {
      const ifaces = await api.get<Array<{ iface: string; type?: string; cidr?: string }>>(
        `/nodes/${node}/network`,
        { type: 'any_bridge' },
      );
      return ifaces.map((i) => ({ id: i.iface, name: i.iface, extra: { cidr: i.cidr ?? null } }));
    }
    return [];
  },
});

export default proxmox;

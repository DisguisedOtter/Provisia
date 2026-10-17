import { describe, expect, it } from 'vitest';
import { ProxmoxError, staticIpOf } from './client.js';
import proxmox from './index.js';
import {
  ctxWith,
  fakeFetch,
  json,
  makeServer,
  makeService,
  type Recorded,
  text,
} from './test-utils.js';

const creds = { tokenId: 'provisia@pve!billing', secret: 'secret-token-123', node: 'pve1' };
const base = { template: '9000', taskPollMs: 10, taskTimeoutSeconds: 10 };
const qemuCfg = proxmox.configSchema.parse({
  ...base,
  cores: 2,
  memoryMb: 2048,
  diskGb: 40,
  storage: 'local-lvm',
});
const lxcCfg = proxmox.configSchema.parse({
  ...base,
  type: 'lxc',
  template: 'local:vztmpl/debian-12.tar.zst',
  ipConfig: 'ip=203.0.113.5/24,gw=203.0.113.1',
  vlanTag: 10,
});
const qemuData = {
  vmid: 101,
  node: 'pve1',
  type: 'qemu' as const,
  name: 'example-client.test',
  diskGb: 40,
  bootDisk: 'scsi0',
};
const lxcData = { vmid: 102, node: 'pve1', type: 'lxc' as const, name: 'ct102', diskGb: 20 };
const pve = (data: unknown) => json({ data });
const UPID = 'UPID:pve1:0000ABCD:00112233:66AABBCC:qmclone:101:root@pam:';
const server = makeServer({ module: 'proxmox', hostname: 'pve.example.test' });

/** Task status route: first `running` polls, then stopped with the given exit status. */
function taskRoute(exit = 'OK', runningPolls = 1) {
  let polls = 0;
  return (r: Recorded) =>
    r.url.includes('/tasks/')
      ? pve(
          polls++ < runningPolls
            ? { status: 'running', upid: UPID }
            : { status: 'stopped', exitstatus: exit, upid: UPID },
        )
      : undefined;
}
const statusRoute =
  (status: string, extra: Record<string, unknown> = {}) =>
  (r: Recorded) =>
    r.url.endsWith('/status/current') ? pve({ status, ...extra }) : undefined;

function setup(routes: Parameters<typeof fakeFetch>[0], cfg: Record<string, unknown> = qemuCfg) {
  const f = fakeFetch(routes);
  return { ...f, ctx: ctxWith(cfg, creds, f.fetch) };
}
const path = (c: Recorded) => `${c.method} ${c.url.split('/api2/json')[1]?.split('?')[0]}`;

describe('proxmox provisioner', () => {
  it('validates credentials and config', () => {
    expect(
      proxmox.credentialsSchema?.safeParse({ tokenId: 'root@pam', secret: 'x'.repeat(10) }).success,
    ).toBe(false);
    expect(proxmox.credentialsSchema?.safeParse(creds).success).toBe(true);
    expect(proxmox.configSchema.safeParse({}).success).toBe(false);
    expect(staticIpOf('ip=dhcp')).toBeUndefined();
    expect(staticIpOf('ip=203.0.113.5/24,gw=203.0.113.1')).toBe('203.0.113.5');
  });

  it('clones a qemu template, configures cloud-init, resizes and starts', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/cluster/nextid') ? pve('101') : undefined),
      (r) => (r.url.includes('/qemu/9000/clone') ? pve(UPID) : undefined),
      (r) => (r.url.endsWith('/qemu/101/config') ? pve(null) : undefined),
      (r) => (r.url.endsWith('/qemu/101/resize') ? pve(UPID) : undefined),
      (r) => (r.url.endsWith('/status/start') ? pve(UPID) : undefined),
      taskRoute('OK', 1),
    ]);
    const res = await proxmox.create(ctx, makeService({ server, password: 'Vm-Pass-123' }));
    expect(calls[0]?.headers.authorization).toBe(
      'PVEAPIToken=provisia@pve!billing=secret-token-123',
    );
    expect(calls[0]?.url).toBe('https://pve.example.test:8006/api2/json/cluster/nextid');
    const clone = calls.find((c) => c.url.includes('/clone')) as Recorded;
    expect(Object.fromEntries(clone.params)).toEqual({
      newid: '101',
      name: 'example-client.test',
      full: '1',
      storage: 'local-lvm',
      target: 'pve1',
    });
    const config = calls.find((c) => c.url.endsWith('/qemu/101/config')) as Recorded;
    expect(Object.fromEntries(config.params)).toMatchObject({
      cores: '2',
      memory: '2048',
      net0: 'virtio,bridge=vmbr0',
      ipconfig0: 'ip=dhcp',
      ciuser: 'root',
      cipassword: 'Vm-Pass-123',
      onboot: '1',
    });
    const resize = calls.find((c) => c.url.endsWith('/resize')) as Recorded;
    expect(Object.fromEntries(resize.params)).toEqual({ disk: 'scsi0', size: '40G' });
    expect(calls.filter((c) => c.url.includes('/tasks/')).length).toBeGreaterThanOrEqual(3);
    expect(res).toMatchObject({
      username: 'root',
      password: 'Vm-Pass-123',
      moduleData: {
        vmid: 101,
        node: 'pve1',
        type: 'qemu',
        name: 'example-client.test',
        diskGb: 40,
        bootDisk: 'scsi0',
      },
      message: 'VM 101 created on pve1',
    });
  });

  it('creates an LXC container with static IP and vlan, resolving the node from the cluster', async () => {
    const { calls, fetch } = setup(
      [
        (r) =>
          r.url.endsWith('/nodes')
            ? pve([
                { node: 'pve9', status: 'offline' },
                { node: 'pve2', status: 'online' },
              ])
            : undefined,
        (r) => (r.url.endsWith('/cluster/nextid') ? pve(102) : undefined),
        (r) => (r.url.endsWith('/nodes/pve2/lxc') ? pve(UPID) : undefined),
        (r) => (r.url.endsWith('/status/start') ? pve(UPID) : undefined),
        taskRoute('OK', 0),
      ],
      lxcCfg,
    );
    const ctxNoNode = ctxWith(lxcCfg, { ...creds, node: undefined }, fetch);
    const res = await proxmox.create(ctxNoNode, makeService({ server, domain: null }));
    const create = calls.find((c) => c.url.endsWith('/nodes/pve2/lxc')) as Recorded;
    expect(Object.fromEntries(create.params)).toMatchObject({
      vmid: '102',
      ostemplate: 'local:vztmpl/debian-12.tar.zst',
      hostname: 'vm102',
      rootfs: 'local-lvm:20',
      net0: 'name=eth0,bridge=vmbr0,ip=203.0.113.5/24,gw=203.0.113.1,tag=10',
      unprivileged: '1',
      swap: '512',
    });
    expect(create.params.get('password')).toMatch(/.{12,}/);
    expect(res).toMatchObject({
      ipAddress: '203.0.113.5',
      moduleData: { type: 'lxc', node: 'pve2', ip: '203.0.113.5' },
    });
  });

  it('fails on task errors and timeouts', async () => {
    const failing = setup([
      (r) => (r.url.endsWith('/cluster/nextid') ? pve('101') : undefined),
      (r) => (r.url.includes('/clone') ? pve(UPID) : undefined),
      taskRoute('clone failed: storage full', 0),
    ]);
    await expect(proxmox.create(failing.ctx, makeService({ server }))).rejects.toMatchObject({
      code: 'task_failed',
      message: /storage full/,
    });
    const slow = setup(
      [
        (r) => (r.url.endsWith('/cluster/nextid') ? pve('101') : undefined),
        (r) => (r.url.includes('/clone') ? pve(UPID) : undefined),
        (r) => (r.url.includes('/tasks/') ? pve({ status: 'running' }) : undefined),
      ],
      { ...qemuCfg, taskTimeoutSeconds: 10, taskPollMs: 10 },
    );
    // deadline is computed from taskTimeoutSeconds; shrink it via a tiny override on the parsed config
    (slow.ctx.config as { taskTimeoutSeconds: number }).taskTimeoutSeconds = 0.02;
    await expect(proxmox.create(slow.ctx, makeService({ server }))).rejects.toMatchObject({
      code: 'task_timeout',
    });
  });

  it('maps HTTP errors', async () => {
    const svc = makeService({ server, moduleData: qemuData });
    const unauth = setup([() => text('', 401)]);
    expect(await proxmox.testConnection(unauth.ctx, server)).toMatchObject({
      ok: false,
      message: /token/,
    });
    const forbidden = setup([() => json({ data: null }, 403)]);
    await expect(proxmox.getUsage?.(forbidden.ctx, svc)).rejects.toMatchObject({
      code: 'permission_denied',
    });
    const apiErr = setup([() => json({ data: null, errors: { memory: 'invalid format' } }, 400)]);
    await expect(proxmox.getUsage?.(apiErr.ctx, svc)).rejects.toThrow(/memory: invalid format/);
    const down = setup([
      () => {
        throw new Error('ECONNREFUSED');
      },
    ]);
    await expect(proxmox.getUsage?.(down.ctx, svc)).rejects.toMatchObject({
      code: 'connection_failed',
    });
    await expect(proxmox.getUsage?.(down.ctx, makeService({ server }))).rejects.toMatchObject({
      code: 'not_provisioned',
    });
    await expect(
      proxmox.getUsage?.(down.ctx, makeService({ server: null, moduleData: qemuData })),
    ).rejects.toBeInstanceOf(ProxmoxError);
  });

  it('suspends (stop + lock) and unsuspends (unlock + start) a VM', async () => {
    const { ctx, calls } = setup([
      statusRoute('running'),
      (r) =>
        r.url.includes('/status/stop') || r.url.includes('/status/start') ? pve(UPID) : undefined,
      (r) => (r.url.endsWith('/config') ? pve(null) : undefined),
      taskRoute('OK', 0),
    ]);
    const svc = makeService({ server, moduleData: qemuData });
    await proxmox.suspend(ctx, svc);
    const lock = calls.find((c) => c.url.endsWith('/config')) as Recorded;
    expect(calls.some((c) => c.url.includes('/status/stop'))).toBe(true);
    expect(Object.fromEntries(lock.params)).toEqual({ lock: 'suspended' });
    calls.length = 0;
    await proxmox.unsuspend(ctx, svc);
    expect(Object.fromEntries((calls[0] as Recorded).params)).toEqual({
      delete: 'lock',
      skiplock: '1',
    });
    expect(calls.some((c) => c.url.includes('/status/start'))).toBe(true);
  });

  it('uses protection instead of lock for containers and skips stop when already stopped', async () => {
    const { ctx, calls } = setup(
      [statusRoute('stopped'), (r) => (r.url.endsWith('/config') ? pve(null) : undefined)],
      lxcCfg,
    );
    await proxmox.suspend(ctx, makeService({ server, moduleData: lxcData }));
    expect(calls.map(path)).toEqual([
      'GET /nodes/pve1/lxc/102/status/current',
      'PUT /nodes/pve1/lxc/102/config',
    ]);
    expect(Object.fromEntries((calls[1] as Recorded).params)).toEqual({ protection: '1' });
  });

  it('terminates: stop, destroy with purge; tolerates missing guests', async () => {
    const { ctx, calls } = setup([
      statusRoute('running'),
      (r) => (r.url.includes('/status/stop') ? pve(UPID) : undefined),
      (r) => (r.method === 'DELETE' ? pve(UPID) : undefined),
      taskRoute('OK', 0),
    ]);
    await proxmox.terminate(ctx, makeService({ server, moduleData: qemuData }));
    const del = calls.find((c) => c.method === 'DELETE') as Recorded;
    expect(del.url).toContain(
      '/nodes/pve1/qemu/101?purge=1&destroy-unreferenced-disks=1&skiplock=1',
    );
    const gone = setup([() => json({ data: null }, 404)]);
    await expect(
      proxmox.terminate(gone.ctx, makeService({ server, moduleData: qemuData })),
    ).resolves.toBeUndefined();
  });

  it('changes package: resources + grow disk, never shrink, never change type', async () => {
    const { ctx, calls } = setup([
      (r) => (r.url.endsWith('/config') ? pve(null) : undefined),
      (r) => (r.url.endsWith('/resize') ? pve(UPID) : undefined),
      taskRoute('OK', 0),
    ]);
    const svc = makeService({ server, moduleData: { ...qemuData } });
    const bigger = {
      ...svc.product,
      moduleConfig: { ...base, cores: 4, memoryMb: 4096, diskGb: 80 },
    };
    await proxmox.changePackage?.(ctx, svc, bigger);
    expect(Object.fromEntries((calls[0] as Recorded).params)).toEqual({
      cores: '4',
      memory: '4096',
    });
    expect(Object.fromEntries((calls[1] as Recorded).params)).toEqual({
      disk: 'scsi0',
      size: '80G',
    });
    expect(svc.moduleData.diskGb).toBe(80);
    calls.length = 0;
    await proxmox.changePackage?.(ctx, svc, {
      ...svc.product,
      moduleConfig: { ...base, diskGb: 10 },
    });
    expect(calls.map(path)).toEqual(['POST /nodes/pve1/qemu/101/config']);
    await expect(
      proxmox.changePackage?.(ctx, svc, { ...svc.product, moduleConfig: { ...base, type: 'lxc' } }),
    ).rejects.toMatchObject({ code: 'type_mismatch' });
  });

  it('changes cloud-init passwords for VMs and refuses for containers', async () => {
    const { ctx, calls } = setup([() => pve(null)]);
    await proxmox.changePassword?.(
      ctx,
      makeService({ server, moduleData: qemuData }),
      'New-Pass-123',
    );
    expect(Object.fromEntries((calls[0] as Recorded).params)).toEqual({
      cipassword: 'New-Pass-123',
    });
    await expect(
      proxmox.changePassword?.(ctx, makeService({ server, moduleData: lxcData }), 'x'),
    ).rejects.toMatchObject({ code: 'not_supported' });
  });

  it('reports usage from status/current', async () => {
    const { ctx } = setup([
      statusRoute('running', {
        cpu: 0.1234,
        cpus: 2,
        mem: 512 * 1024 ** 2,
        maxmem: 2048 * 1024 ** 2,
        disk: 0,
        maxdisk: 40 * 1024 ** 3,
        netin: 1024 ** 2,
        netout: 2 * 1024 ** 2,
        uptime: 99,
      }),
    ]);
    expect(await proxmox.getUsage?.(ctx, makeService({ server, moduleData: qemuData }))).toEqual({
      diskUsedMb: 0,
      diskLimitMb: 40960,
      bandwidthUsedMb: 3,
      extra: {
        status: 'running',
        cpuPercent: 12.3,
        cpus: 2,
        memUsedMb: 512,
        memLimitMb: 2048,
        netInMb: 1,
        netOutMb: 2,
        uptimeSeconds: 99,
      },
    });
  });

  it('power actions respect current state and locks', async () => {
    const running = setup([
      statusRoute('running'),
      (r) => (r.url.includes('/status/') ? pve(UPID) : undefined),
      taskRoute('OK', 0),
    ]);
    const svc = makeService({ server, moduleData: qemuData });
    await proxmox.power?.(running.ctx, svc, 'start');
    expect(running.calls.map(path)).toEqual(['GET /nodes/pve1/qemu/101/status/current']); // no-op
    await proxmox.power?.(running.ctx, svc, 'reboot');
    expect(running.calls.map(path)).toContain('POST /nodes/pve1/qemu/101/status/reboot');
    const stopped = setup([
      statusRoute('stopped'),
      (r) => (r.url.includes('/status/') ? pve(UPID) : undefined),
      taskRoute('OK', 0),
    ]);
    await proxmox.power?.(stopped.ctx, svc, 'reboot');
    expect(stopped.calls.map(path)).toContain('POST /nodes/pve1/qemu/101/status/start');
    await proxmox.power?.(stopped.ctx, svc, 'shutdown');
    expect(stopped.calls.filter((c) => c.url.includes('/status/shutdown'))).toHaveLength(0);
    const locked = setup([statusRoute('stopped', { lock: 'suspended' })]);
    await expect(proxmox.power?.(locked.ctx, svc, 'start')).rejects.toMatchObject({
      code: 'locked',
    });
  });

  it('builds a noVNC console URL', async () => {
    const { ctx } = setup([]);
    expect(await proxmox.loginUrl?.(ctx, makeService({ server, moduleData: qemuData }))).toBe(
      'https://pve.example.test:8006/?console=kvm&novnc=1&vmid=101&vmname=example-client.test&node=pve1&resize=off',
    );
  });

  it('tests connection and discovers nodes, templates, storages and bridges', async () => {
    const { ctx } = setup([
      (r) => (r.url.endsWith('/version') ? pve({ version: '8.3.1', release: '8.3' }) : undefined),
      (r) =>
        r.url.endsWith('/nodes')
          ? pve([{ node: 'pve1', status: 'online', maxcpu: 16 }])
          : undefined,
      (r) =>
        r.url.endsWith('/nodes/pve1/qemu')
          ? pve([
              { vmid: 9000, name: 'debian-tpl', template: 1 },
              { vmid: 100, name: 'vm' },
            ])
          : undefined,
      (r) =>
        r.url.includes('/storage/local/content')
          ? pve([{ volid: 'local:vztmpl/debian-12.tar.zst', size: 1 }])
          : undefined,
      (r) => (r.url.includes('/content') ? pve([]) : undefined),
      (r) =>
        r.url.includes('/nodes/pve1/storage')
          ? pve([
              { storage: 'local', content: 'vztmpl,iso', type: 'dir', avail: 10 * 1024 ** 3 },
              {
                storage: 'local-lvm',
                content: 'images,rootdir',
                type: 'lvmthin',
                avail: 100 * 1024 ** 3,
              },
            ])
          : undefined,
      (r) =>
        r.url.includes('/network')
          ? pve([{ iface: 'vmbr0', type: 'bridge', cidr: '10.0.0.1/24' }])
          : undefined,
    ]);
    expect(await proxmox.testConnection(ctx, server)).toEqual({
      ok: true,
      message: 'Proxmox VE 8.3.1',
    });
    expect(await proxmox.listRemoteOptions?.(ctx, server, 'nodes')).toEqual([
      { id: 'pve1', name: 'pve1', extra: { status: 'online', cpus: 16 } },
    ]);
    const templates = await proxmox.listRemoteOptions?.(ctx, server, 'templates');
    expect(templates?.map((t) => t.id)).toEqual(['9000', 'local:vztmpl/debian-12.tar.zst']);
    expect(templates?.[0]).toMatchObject({ name: 'debian-tpl (VM 9000)', extra: { type: 'qemu' } });
    const storages = await proxmox.listRemoteOptions?.(ctx, server, 'storages');
    expect(storages).toEqual([
      { id: 'local-lvm', name: 'local-lvm', extra: { type: 'lvmthin', availGb: 100 } },
    ]);
    expect(await proxmox.listRemoteOptions?.(ctx, server, 'bridges')).toEqual([
      { id: 'vmbr0', name: 'vmbr0', extra: { cidr: '10.0.0.1/24' } },
    ]);
    expect(await proxmox.listRemoteOptions?.(ctx, server, 'packages')).toEqual([]);
  });
});

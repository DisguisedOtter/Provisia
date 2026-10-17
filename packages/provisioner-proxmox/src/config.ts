import { z } from 'zod';

/** Product-level configuration (stored in `products.module_config`). */
export const proxmoxConfigSchema = z.object({
  /** `qemu` = clone a VM template; `lxc` = create a container from an OS template. */
  type: z.enum(['qemu', 'lxc']).default('qemu'),
  /** Target node; falls back to the server credentials' `node`, then the first cluster node. */
  node: z.string().max(100).optional(),
  /** qemu: VMID of the template to clone. lxc: template volid, e.g. `local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst`. */
  template: z.string().min(1).max(255),
  cores: z.number().int().min(1).max(256).default(1),
  memoryMb: z.number().int().min(128).default(1024),
  /** lxc only. */
  swapMb: z.number().int().min(0).default(512),
  /** Disk size in GB. qemu: the boot disk is resized after cloning (grow only). lxc: rootfs size. */
  diskGb: z.number().int().min(1).default(20),
  /** Target storage for the clone / rootfs; empty = keep the template's storage (qemu) or `local-lvm` (lxc). */
  storage: z.string().max(100).optional(),
  /** qemu: name of the boot disk to resize (`scsi0`, `virtio0`, ...). */
  bootDisk: z.string().max(20).default('scsi0'),
  bridge: z.string().max(50).default('vmbr0'),
  vlanTag: z.number().int().min(1).max(4094).optional(),
  /** `ip=dhcp` or `ip=203.0.113.5/24,gw=203.0.113.1` (cloud-init `ipconfig0` / lxc `net0`). */
  ipConfig: z.string().max(255).default('ip=dhcp'),
  nameserver: z.string().max(255).optional(),
  /** qemu: cloud-init user that receives the password. */
  ciUser: z.string().max(64).default('root'),
  /** Public SSH keys (newline separated) injected via cloud-init / lxc `ssh-public-keys`. */
  sshKeys: z.string().max(10_000).optional(),
  fullClone: z.boolean().default(true),
  unprivileged: z.boolean().default(true),
  onboot: z.boolean().default(true),
  startAfterCreate: z.boolean().default(true),
  /** Hostname / VM name when the service has no domain. */
  hostnamePrefix: z.string().max(20).default('vm'),
  /** Max seconds to wait for a Proxmox task (clone, destroy, ...). */
  taskTimeoutSeconds: z.number().int().min(10).max(3600).default(600),
  /** Task status poll interval (ms). Lowered in tests. */
  taskPollMs: z.number().int().min(10).default(2000),
});
export type ProxmoxConfig = z.infer<typeof proxmoxConfigSchema>;

/** Server-level credentials. */
export const proxmoxCredentialsSchema = z.object({
  /** `user@realm!tokenid`, e.g. `provisia@pve!billing`. */
  tokenId: z.string().regex(/^[^@!\s]+@[^@!\s]+![^@!\s]+$/, 'format: user@realm!tokenid'),
  secret: z.string().min(8),
  /** Default node for products that do not set one. */
  node: z.string().max(100).optional(),
});
export type ProxmoxCredentials = z.infer<typeof proxmoxCredentialsSchema>;

/** Persisted in `services.module_data`. */
export interface ProxmoxModuleData {
  vmid: number;
  node: string;
  type: 'qemu' | 'lxc';
  name: string;
  diskGb: number;
  bootDisk?: string;
  ip?: string;
}

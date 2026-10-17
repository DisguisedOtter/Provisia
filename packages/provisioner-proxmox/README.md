# @provisia/provisioner-proxmox

Provisioner module for **Proxmox VE 7/8** (`https://host:8006/api2/json`) with API-token auth
(`Authorization: PVEAPIToken=user@realm!tokenid=secret`). Module id: `proxmox`. Creates QEMU VMs by cloning
a template or LXC containers from an OS template.

## Mapping

| Provisia action | Proxmox API |
|---|---|
| create (qemu) | `GET /cluster/nextid` → `POST /nodes/{n}/qemu/{template}/clone` → `POST …/config` (cores, memory, net0, ipconfig0, ciuser, cipassword, sshkeys, onboot) → `PUT …/resize` → `POST …/status/start` |
| create (lxc) | `GET /cluster/nextid` → `POST /nodes/{n}/lxc` (ostemplate, rootfs, net0, password, …) → start |
| suspend | stop (if running) + `lock=suspended` (qemu) / `protection=1` (lxc) |
| unsuspend | remove lock (`delete=lock&skiplock=1`) / `protection=0`, then start |
| terminate | stop + `DELETE /nodes/{n}/{type}/{vmid}?purge=1` (+ `destroy-unreferenced-disks`, `skiplock` for qemu; `force` for lxc) |
| changePackage | cores/memory(/swap) via config, disk grown via `PUT …/resize` (Proxmox cannot shrink; type qemu↔lxc cannot change) |
| changePassword | qemu: `cipassword` (cloud-init, applies at next boot). lxc: **not supported** by the PVE API → explicit error |
| power (start/stop/shutdown/reboot) | `POST …/status/{action}`; no-ops when already in the target state; refused while locked |
| getUsage | `GET …/status/current` (cpu, mem/maxmem, disk/maxdisk, netin/netout, uptime) |
| loginUrl | noVNC console URL `https://host:8006/?console=kvm|lxc&novnc=1&vmid=…&node=…` — the user must have a PVE session; API tokens cannot mint browser tickets |
| testConnection | `GET /version` |
| listRemoteOptions | `nodes` (`/nodes`), `templates` (qemu templates on the node + `vztmpl` storage content), `storages` (`images`/`rootdir` capable), `bridges` (`/network?type=any_bridge`) |

Every asynchronous call returns a UPID; the module polls `GET /nodes/{n}/tasks/{upid}/status` every
`taskPollMs` until `stopped`, fails on a non-`OK` exit status and aborts after `taskTimeoutSeconds`.

## Server credentials

```json
{ "tokenId": "provisia@pve!billing", "secret": "xxxxxxxx-xxxx-…", "node": "pve1" }
```

Create a user + token: Datacenter » Permissions » API Tokens (untick *Privilege Separation* or grant the token
itself). Required privileges on `/` (or on the pool/node/storage you use):
`VM.Allocate`, `VM.Clone`, `VM.Config.*` (CPU, Memory, Disk, Network, Cloudinit, Options), `VM.PowerMgmt`,
`VM.Audit`, `VM.Console`, `Datastore.AllocateSpace`, `Datastore.Audit`, `Sys.Audit`, `SDN.Use` (bridges).
The built-in role `PVEVMAdmin` + `PVEDatastoreUser` + `PVEAuditor` covers this. Setting `lock` and `skiplock`
on QEMU guests requires `root@pam` in some PVE versions; if suspension fails with a permission error, use a
root token or switch the product to LXC (which uses `protection`).

`node` is the default target; a product can override it. Use one server record per node for capacity
accounting, or one per cluster if you let `/nodes` decide.

## Product config

```json
{
  "type": "qemu", "template": "9000", "cores": 2, "memoryMb": 2048, "diskGb": 40, "storage": "local-lvm",
  "bootDisk": "scsi0", "bridge": "vmbr0", "ipConfig": "ip=dhcp", "ciUser": "root", "fullClone": true,
  "onboot": true, "startAfterCreate": true, "taskTimeoutSeconds": 600
}
```

For LXC: `"type": "lxc", "template": "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", "swapMb": 512,
"unprivileged": true`. `ipConfig` follows the PVE syntax (`ip=dhcp` or `ip=a.b.c.d/24,gw=a.b.c.1`); a static IP
is reported back as the service IP. QEMU templates must have a cloud-init drive for passwords/IPs to apply.

## Module data

`{ vmid, node, type, name, diskGb, bootDisk?, ip? }`.

## Testing

`pnpm --filter @provisia/provisioner-proxmox test` (mocked HTTP incl. task polling). For a sandbox install PVE
in a nested VM (or use the no-subscription repo on any box), create a cloud-init template
(`qm create 9000 … && qm importdisk … && qm template 9000`) and download an LXC template via
`pveam download local debian-12-standard…`.

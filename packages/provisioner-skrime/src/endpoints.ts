/**
 * Skrime reseller API endpoints (https://skrime.eu/docs, "KVM Server", "Webspace" and "Produkt").
 * All paths are relative to `https://skrime.eu/api`; every call carries `Authorization: Bearer <token>`
 * and answers `{ response, state, data }`. Product ids are UUIDs (`productId`).
 */
export const SKRIME_ENDPOINTS = {
  product: {
    /** GET { type? } → products of the account (cheap key check). */
    all: 'product/all',
    /** GET { productId } → product incl. state, price, expireAt, autoRenew. */
    single: 'product/single',
    /** POST { productId, name } → custom name shown in the Skrime panel. */
    name: 'product/name',
    /** POST { productId, autoRenew } */
    autorenew: 'product/autorenew',
    /** POST { productId, prepayMonths? } → renews from the reseller balance. */
    renew: 'product/renew',
    /** GET { productId } → audit log of the product. */
    log: 'product/log',
  },
  webspace: {
    /** GET { productId?, planId? } → plans [{ id, productInfo: { name, disk }, price, finalRenewPrice }]. */
    pricelist: 'webspace/pricelist',
    /** POST { planId, tos, cancellation } → product { id, productInfo: { username, password, plan_id } }. */
    order: 'webspace/order',
    /** GET { productId | domain } → { domain, ipv4, ipv6, username, password, disk: { limit, used, percentage } } (MB). */
    information: 'webspace/information',
    /** GET { productId | domain } → { loginUrl } (Plesk SSO). */
    login: 'webspace/login',
    /** POST { productId | domain, password? } (min 8 chars). */
    passwd: 'webspace/passwd',
    /** POST { productId, planId } → up/downgrade. */
    upgrade: 'webspace/upgrade',
    /** DELETE { productId | domain, password? } → { username, password }. */
    reinstall: 'webspace/reinstall',
  },
  server: {
    /** GET { type: 'server' | 'server-config', ... } → plans or configurator price. */
    pricelist: 'server/pricelist',
    /** GET → [{ id, name, proxmoxId, type: 'os' | 'app', group, minDisk }]. */
    os: 'server/os',
    /** POST { osName, password?, tos, cancellation, notice, planId | cores,memory,disk,ipv4,ipv6,connection, prepayMonths? }. */
    order: 'server/order',
    /** GET { productId, lazy? } → { status, os, ipv4, ipv6, username, password, coresUsed, memoryUsed, diskUsed }. */
    information: 'server/information',
    /** GET { productId } → { url } (noVNC console). */
    novnc: 'server/novnc',
    /** POST { productId, action: 'start' | 'stop' }. */
    action: 'server/action',
    /** POST { productId, password } (min 8 chars). */
    passwd: 'server/passwd',
    /** GET { productId } → { ipv4: [{ ipAddress, gateway, hostname }], ipv6: [...] }. */
    network: 'server/network',
    /** GET { productId, scope: stats|ports|attacks|attack, ... } / DELETE { productId, ruleId }. */
    ddos: 'server/ddos',
    /** GET { productId } / POST { productId, action: create|edit|move, rule?, oldPos?, pos? } / DELETE { productId, pos }. */
    firewall: 'server/firewall',
    /** POST { productId, ipAddress, hostname } / DELETE { productId, ipAddress }. */
    rdns: 'server/rdns',
    /** POST { productId } → adds a paid IPv4 address. */
    ip: 'server/ip',
    /** GET { productId, period: hour|day|week|month } → { statistics: [{ time, cpu, memory, netin, netout }] }. */
    statistic: 'server/statistic',
    /** GET { productId } → { backups: [{ volid, size, createdAt }] } / POST { productId, volid } → restore. */
    backup: 'server/backup',
    /** DELETE { productId, osName, password? } → { osName, password }. */
    reinstall: 'server/reinstall',
  },
} as const;

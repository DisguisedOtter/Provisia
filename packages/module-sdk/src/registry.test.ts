import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineGateway, defineProvisioner } from './define.js';
import { ModuleNotFoundError, ModuleRegistry } from './registry.js';

const dummy = defineGateway({
  id: 'dummy',
  name: 'Dummy',
  version: '0.0.1',
  configSchema: z.object({ apiKey: z.string() }),
  capabilities: { refunds: false, savedMethods: false, recurring: false },
  async createPayment(ctx, invoice) {
    // ctx.config is typed from configSchema
    return { txnId: `${ctx.config.apiKey}-${invoice.id}` };
  },
  async handleWebhook() {
    return { kind: 'ignored', reason: 'test' };
  },
});

const prov = defineProvisioner({
  id: 'noop',
  name: 'No-op',
  version: '0.0.1',
  configSchema: z.object({}),
  async create() {
    return { moduleData: {} };
  },
  async suspend() {},
  async unsuspend() {},
  async terminate() {},
  async testConnection() {
    return { ok: true };
  },
});

describe('ModuleRegistry', () => {
  it('registers, gets and lists per kind', () => {
    const r = new ModuleRegistry().register('gateway', dummy).register('provisioner', prov);
    expect(r.get('gateway', 'dummy')).toBe(dummy);
    expect(r.find('registrar', 'dummy')).toBeUndefined();
    expect(r.has('provisioner', 'noop')).toBe(true);
    expect(r.list('gateway')).toEqual([dummy]);
    expect(r.list('registrar')).toEqual([]);
    expect(r.describe()).toEqual([
      { kind: 'gateway', id: 'dummy', name: 'Dummy', version: '0.0.1' },
      { kind: 'provisioner', id: 'noop', name: 'No-op', version: '0.0.1' },
    ]);
  });

  it('rejects duplicates and throws on unknown ids', () => {
    const r = new ModuleRegistry().register('gateway', dummy);
    expect(() => r.register('gateway', dummy)).toThrow(/already registered/);
    expect(() => r.get('gateway', 'nope')).toThrow(ModuleNotFoundError);
  });
});

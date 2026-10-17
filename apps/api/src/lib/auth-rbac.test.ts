import { DEFAULT_ROLES, hasAllPermissions, hasPermission, PERMISSIONS } from '@provisia/shared';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { requirePermission, requireRole } from './auth.js';
import { AppError } from './errors.js';

function fakeReq(auth: Record<string, unknown> | null, url = '/api/v1/admin/clients') {
  return { auth, url } as unknown as FastifyRequest;
}
const reply = {} as never;
const user = (
  role: 'admin' | 'staff' | 'client',
  permissions: string[] = [],
  extra = {},
): Record<string, unknown> => ({
  user: { id: 'u', role, permissions, totpEnrollmentRequired: false, ...extra },
  via: 'session',
});

async function run(guard: ReturnType<typeof requirePermission>, req: FastifyRequest) {
  try {
    await guard.call({} as never, req, reply);
    return 200;
  } catch (err) {
    if (err instanceof AppError) return { status: err.status, code: err.code };
    throw err;
  }
}

describe('hasPermission', () => {
  it('matrix', () => {
    const cases: Array<[string[], string, boolean]> = [
      [['*'], 'anything.write', true],
      [['clients.read'], 'clients.read', true],
      [['clients.read'], 'clients.write', false],
      [['clients.write'], 'clients.read', true], // write implies read
      [['users.manage'], 'users.read', true],
      [['clients.*'], 'clients.impersonate', true],
      [['clients.*'], 'invoices.read', false],
      [[], 'clients.read', false],
      [['invoices.read', 'tickets.write'], 'tickets.read', true],
    ];
    for (const [granted, required, expected] of cases) {
      expect(hasPermission(granted, required), `${granted} -> ${required}`).toBe(expected);
    }
    expect(
      hasAllPermissions(['clients.write', 'invoices.read'], ['clients.read', 'invoices.read']),
    ).toBe(true);
    expect(hasAllPermissions(['clients.write'], ['clients.read', 'invoices.read'])).toBe(false);
  });

  it('default roles only reference known permissions', () => {
    for (const r of DEFAULT_ROLES) {
      for (const p of r.permissions) {
        expect(p === '*' || (PERMISSIONS as readonly string[]).includes(p), `${r.name}: ${p}`).toBe(
          true,
        );
      }
    }
    const support = DEFAULT_ROLES.find((r) => r.name === 'Support')?.permissions ?? [];
    expect(hasPermission(support, 'tickets.write')).toBe(true);
    expect(hasPermission(support, 'settings.manage')).toBe(false);
    expect(hasPermission(support, 'invoices.write')).toBe(false);
  });
});

describe('requirePermission / requireRole', () => {
  it('401 when anonymous, 403 for clients, 200 for admin', async () => {
    const g = requirePermission('clients.read');
    expect(await run(g, fakeReq(null))).toEqual({ status: 401, code: 'unauthorized' });
    expect(await run(g, fakeReq(user('client')))).toEqual({ status: 403, code: 'forbidden' });
    expect(await run(g, fakeReq(user('admin', ['*'])))).toBe(200);
  });

  it('staff need the permission from their roles', async () => {
    const g = requirePermission('invoices.write');
    expect(await run(g, fakeReq(user('staff', ['invoices.read'])))).toEqual({
      status: 403,
      code: 'forbidden',
    });
    expect(await run(g, fakeReq(user('staff', ['invoices.*'])))).toBe(200);
  });

  it('API keys are limited by their scopes', async () => {
    const g = requirePermission('clients.write');
    const req = fakeReq({
      ...user('admin', ['*']),
      via: 'api_key',
      apiKeyScopes: ['clients.read'],
    });
    expect(await run(g, req)).toEqual({ status: 403, code: 'insufficient_scope' });
    const ok = fakeReq({
      ...user('admin', ['*']),
      via: 'api_key',
      apiKeyScopes: ['clients.*'],
    });
    expect(await run(g, ok)).toBe(200);
  });

  it('blocks staff who must enrol in 2FA, except on /auth routes', async () => {
    const g = requireRole('admin', 'staff');
    const blocked = fakeReq(user('staff', [], { totpEnrollmentRequired: true }));
    expect(await run(g, blocked)).toEqual({ status: 403, code: 'totp_enrollment_required' });
    const allowed = fakeReq(
      user('staff', [], { totpEnrollmentRequired: true }),
      '/api/v1/auth/2fa/setup',
    );
    expect(await run(g, allowed)).toBe(200);
  });
});

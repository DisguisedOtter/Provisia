import { hasPermission, type UserRole } from '@provisia/shared';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError, forbidden, unauthorized } from './errors.js';

/**
 * Auth guards. Semantics (see docs/SECURITY.md):
 *  - 401 `unauthorized`           no valid session / API key
 *  - 403 `forbidden`              authenticated but the role/permission does not allow it
 *  - 403 `insufficient_scope`     the API key's scopes do not cover the permission
 *  - 403 `totp_enrollment_required`  staff must enrol in 2FA first (setting `security.require2faForStaff`)
 */

function assertTotpEnrolled(req: FastifyRequest) {
  if (req.auth?.user.totpEnrollmentRequired && !req.url.startsWith('/api/v1/auth/')) {
    throw new AppError(
      'totp_enrollment_required',
      'Two-factor authentication must be enabled for staff accounts',
      403,
    );
  }
}

/**
 * preHandler that requires an authenticated user with one of the given roles.
 *
 *   app.get('/admin/x', { preHandler: requireRole('admin', 'staff') }, handler)
 *
 * Prefer `requirePermission()` for staff routes; `requireRole` stays for coarse checks.
 */
export function requireRole(...roles: UserRole[]): preHandlerAsyncHookHandler {
  const staffRoute = roles.some((r) => r !== 'client');
  return async (req) => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.user.role)) throw forbidden();
    // Coarse staff guard: a scoped API key cannot exceed its scopes through routes that only check the role.
    if (
      staffRoute &&
      req.auth.via === 'api_key' &&
      !hasPermission(req.auth.apiKeyScopes ?? ['*'], '*')
    ) {
      throw new AppError(
        'insufficient_scope',
        'This endpoint requires an unrestricted API key',
        403,
      );
    }
    assertTotpEnrolled(req);
  };
}

/**
 * Fine-grained RBAC: the user must hold every listed permission (`admin` holds `*`; staff hold the union of
 * their roles; clients hold none). API-key requests must additionally carry a covering scope.
 *
 *   app.put('/admin/clients/:id', { preHandler: requirePermission('clients.write') }, handler)
 */
export function requirePermission(...permissions: string[]): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.auth) throw unauthorized();
    const { user } = req.auth;
    if (user.role === 'client') throw forbidden();
    for (const p of permissions) {
      if (!hasPermission(user.permissions, p)) throw forbidden(`Missing permission: ${p}`);
    }
    if (req.auth.via === 'api_key') {
      const scopes = req.auth.apiKeyScopes ?? ['*'];
      for (const p of permissions) {
        if (!hasPermission(scopes, p)) {
          throw new AppError('insufficient_scope', `API key lacks scope: ${p}`, 403);
        }
      }
    }
    assertTotpEnrolled(req);
  };
}

/** True when the current request may exercise `permission` (for conditional fields, not for guarding). */
export function can(req: FastifyRequest, permission: string): boolean {
  if (!req.auth || req.auth.user.role === 'client') return false;
  if (!hasPermission(req.auth.user.permissions, permission)) return false;
  if (req.auth.via === 'api_key' && !hasPermission(req.auth.apiKeyScopes ?? ['*'], permission)) {
    return false;
  }
  return true;
}

/** Any authenticated user. */
export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  if (!req.auth) throw unauthorized();
};

/** Any authenticated user whose login came from a session cookie (not an API key); for account self-service. */
export const requireSession: preHandlerAsyncHookHandler = async (req) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.via !== 'session') throw forbidden('This endpoint requires a browser session');
};

/** Admin or staff — the `/api/v1/admin/*` guard. */
export const requireStaff = requireRole('admin', 'staff');
/** The `/api/v1/portal/*` guard. */
export const requireClient = requireRole('client');
/** Admin only. */
export const requireAdmin = requireRole('admin');

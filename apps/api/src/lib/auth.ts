import type { UserRole } from '@provisia/shared';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { forbidden, unauthorized } from './errors.js';

/**
 * preHandler that requires an authenticated user with one of the given roles.
 *
 *   app.get('/admin/x', { preHandler: requireRole('admin', 'staff') }, handler)
 */
export function requireRole(...roles: UserRole[]): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.user.role)) throw forbidden();
  };
}

/** Any authenticated user. */
export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  if (!req.auth) throw unauthorized();
};

/** Admin or staff — the `/api/v1/admin/*` guard. */
export const requireStaff = requireRole('admin', 'staff');
/** The `/api/v1/portal/*` guard. */
export const requireClient = requireRole('client');

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

/**
 * Security headers, CORS and rate limits. See docs/SECURITY.md.
 *
 * Rate limits (per IP, per route group; a route's own `config.rateLimit` wins):
 *   /api/v1/auth/*     20 / min   (login itself: 10 / min; forgot-password: 5 / 15 min)
 *   /api/v1/public/*   60 / min
 *   /api/v1/portal/*  300 / min
 *   /api/v1/admin/*   600 / min
 *   everything else   300 / min
 */
export const ROUTE_GROUP_LIMITS: Array<{ prefix: string; max: number; timeWindow: string }> = [
  { prefix: '/api/v1/auth/', max: 20, timeWindow: '1 minute' },
  { prefix: '/api/v1/public/', max: 60, timeWindow: '1 minute' },
  { prefix: '/api/v1/portal/', max: 300, timeWindow: '1 minute' },
  { prefix: '/api/v1/admin/', max: 600, timeWindow: '1 minute' },
];

export default fp(
  async (app) => {
    const isProd = app.config.NODE_ENV === 'production';
    await app.register(helmet, {
      // The API serves JSON; the CSP only matters for Swagger UI (inline scripts/styles) and error pages.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // browser access is governed by CORS below
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      xFrameOptions: { action: 'deny' },
      xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    });
    await app.register(cors, {
      origin: [...new Set([app.config.WEB_URL, app.config.APP_URL].map((u) => new URL(u).origin))],
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-requested-with'],
      maxAge: 600,
    });
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      // Per-user (session/api key) buckets once authenticated, per-IP otherwise.
      keyGenerator: (req) => {
        const a = req.auth;
        if (a?.via === 'api_key' && a.apiKeyId) return `key:${a.apiKeyId}`;
        if (a?.via === 'session') return `user:${a.user.id}`;
        return req.ip;
      },
      errorResponseBuilder: (_req, ctx) =>
        new AppError('rate_limited', `Rate limit exceeded, retry in ${ctx.after}`, 429),
    });

    // Route-group defaults: applied when the route did not set its own `config.rateLimit`.
    app.addHook('onRoute', (route) => {
      const url = route.url;
      const group = ROUTE_GROUP_LIMITS.find((g) => url.startsWith(g.prefix));
      if (!group) return;
      const cfg = (route.config ?? {}) as Record<string, unknown>;
      if (cfg.rateLimit !== undefined) return;
      route.config = { ...cfg, rateLimit: { max: group.max, timeWindow: group.timeWindow } };
    });

    // Defensive: never cache authenticated API responses in shared caches.
    app.addHook('onSend', async (req, reply) => {
      if (req.auth && !reply.hasHeader('cache-control')) {
        reply.header('cache-control', 'no-store');
      }
    });
  },
  { name: 'security' },
);

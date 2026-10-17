import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: { title: 'Provisia API', version: '0.1.0' },
        servers: [{ url: app.config.APP_URL }],
        components: {
          securitySchemes: {
            cookie: { type: 'apiKey', in: 'cookie', name: 'pv_session' },
            bearer: { type: 'http', scheme: 'bearer', description: 'API key `pv_...`' },
          },
        },
        security: [{ cookie: [] }, { bearer: [] }],
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });
    await app.register(swaggerUi, {
      routePrefix: '/api/docs',
      // Staff only in production (the UI needs the session cookie); open in development and tests.
      uiHooks: {
        onRequest: (req, _reply, done) => {
          if (app.config.NODE_ENV !== 'production') return done();
          const role = req.auth?.user.role;
          if (role === 'admin' || role === 'staff') return done();
          done(new AppError('not_found', 'Not found', 404));
        },
      },
    });
  },
  { name: 'swagger' },
);

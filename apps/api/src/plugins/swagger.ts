import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

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
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  },
  { name: 'swagger' },
);

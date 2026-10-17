import type { ErrorEnvelope } from '@provisia/shared';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

function envelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export default fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError, req, reply) => {
      if (err instanceof AppError) {
        return reply.status(err.status).send(envelope(err.code, err.message, err.details));
      }
      if (hasZodFastifySchemaValidationErrors(err)) {
        const details = err.validation.map((v) => ({
          path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: v.message,
        }));
        return reply
          .status(400)
          .send(envelope('validation_error', 'Request validation failed', details));
      }
      if (isResponseSerializationError(err)) {
        req.log.error({ err }, 'response does not match schema');
        return reply.status(500).send(envelope('internal_error', 'Response serialization failed'));
      }
      const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
      if (status >= 500) {
        req.log.error({ err }, 'unhandled error');
        return reply.status(status).send(envelope('internal_error', 'Internal server error'));
      }
      return reply
        .status(status)
        .send(envelope(STATUS_CODES[status] ?? 'bad_request', err.message));
    });

    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send(envelope('not_found', `Route ${req.method} ${req.url} not found`)),
    );
  },
  { name: 'error-handler' },
);

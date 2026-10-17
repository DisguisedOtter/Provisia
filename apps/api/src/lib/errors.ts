import { ErrorCodes, type KnownErrorCode } from '@provisia/shared';

/** Throw from anywhere in a request; the error handler turns it into the error envelope. */
export class AppError extends Error {
  constructor(
    public readonly code: KnownErrorCode | (string & {}),
    message: string,
    public readonly status: number = ErrorCodes[code as KnownErrorCode] ?? 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new AppError('unauthorized', message);
export const forbidden = (message = 'Insufficient permissions') =>
  new AppError('forbidden', message);
export const notFound = (entity = 'Resource') => new AppError('not_found', `${entity} not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError('conflict', message, 409, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError('bad_request', message, 400, details);

import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '@provisia/db';
import { AppError, badRequest } from './errors.js';
import { getSettings } from './settings.js';

/**
 * Upload safety helpers for the tickets/invoices modules. Always build on-disk paths through
 * `resolveStoragePath()`: it refuses `..`, absolute segments, NUL bytes and anything that escapes the root.
 */

export const payloadTooLarge = (maxBytes: number) =>
  new AppError('payload_too_large', `File exceeds the maximum size of ${maxBytes} bytes`, 413);

/** Strips directories and dangerous characters; keeps the extension. Never empty. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/\0/g, '');
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 150);
  return cleaned || 'file';
}

export function fileExtension(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

/** Random, extension-preserving storage name so user input never becomes a path component. */
export function randomStorageName(originalName: string): string {
  const ext = fileExtension(sanitizeFilename(originalName));
  return `${Date.now().toString(36)}-${randomBytes(12).toString('hex')}${ext ? `.${ext}` : ''}`;
}

/**
 * Joins `segments` under `root` and verifies the result stays inside `root`.
 * Throws 400 `invalid_path` on traversal attempts.
 */
export function resolveStoragePath(root: string, ...segments: string[]): string {
  const absRoot = path.resolve(root);
  for (const s of segments) {
    if (typeof s !== 'string' || s.length === 0)
      throw new AppError('invalid_path', 'Empty path segment', 400);
    if (s.includes('\0') || path.isAbsolute(s) || s.split(/[\\/]/).some((p) => p === '..')) {
      throw new AppError('invalid_path', 'Path segment is not allowed', 400);
    }
  }
  const resolved = path.resolve(absRoot, ...segments);
  if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
    throw new AppError('invalid_path', 'Path escapes the storage root', 400);
  }
  return resolved;
}

export interface UploadPolicy {
  root: string;
  tempRoot: string;
  maxBytes: number;
  allowedExtensions: Set<string>;
}

/** Reads the `storage` settings group into a policy object (cached by getSettings). */
export async function getUploadPolicy(db: Db): Promise<UploadPolicy> {
  const s = await getSettings(db, 'storage');
  return {
    root: path.resolve(s.localPath),
    tempRoot: path.resolve(s.tempPath),
    maxBytes: s.maxUploadMb * 1024 * 1024,
    allowedExtensions: new Set(s.allowedExtensions.map((e) => e.toLowerCase().replace(/^\./, ''))),
  };
}

/** Validates name + size against the policy; throws 400/413 with stable codes. */
export function assertUploadAllowed(
  policy: UploadPolicy,
  file: { filename: string; size?: number; mimetype?: string },
): void {
  const ext = fileExtension(file.filename);
  if (!ext || !policy.allowedExtensions.has(ext)) {
    throw badRequest(`File type .${ext || '?'} is not allowed`, {
      allowed: [...policy.allowedExtensions],
    });
  }
  if (file.size !== undefined && file.size > policy.maxBytes)
    throw payloadTooLarge(policy.maxBytes);
  if (
    file.mimetype &&
    /^(text\/html|application\/(x-)?javascript|image\/svg\+xml)$/i.test(file.mimetype)
  ) {
    throw badRequest('Active content is not allowed');
  }
}

/** Ensures `<root>/<area>/<id>` exists and returns the absolute, validated path. */
export async function ensureStorageDir(root: string, ...segments: string[]): Promise<string> {
  const dir = resolveStoragePath(root, ...segments);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Content-Disposition value that is safe for arbitrary user supplied names. */
export function contentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment') {
  const safe = sanitizeFilename(filename);
  return `${type}; filename="${safe.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

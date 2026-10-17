import type { ZodObject, z } from 'zod';

export interface ModuleLogger {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

/** `fetch` that rejects with `AbortError` after `timeoutMs` (default 30s). */
export type FetchWithTimeout = (
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

/** Everything a module gets per call. Create one with `createModuleContext()`. */
export interface ModuleContext<TConfig = Record<string, unknown>> {
  /** Module config parsed with the module's `configSchema` (secrets already decrypted). */
  config: TConfig;
  /** Decrypted server credentials, present for provisioner calls. */
  credentials: Record<string, unknown>;
  logger: ModuleLogger;
  fetch: FetchWithTimeout;
  /** Public base URL of the API, e.g. for webhook / callback URLs. */
  appUrl: string;
  /** Public base URL of the web app, e.g. for return URLs after checkout. */
  webUrl: string;
}

export type GatewayContext<TConfig = Record<string, unknown>> = ModuleContext<TConfig>;
export type RegistrarContext<TConfig = Record<string, unknown>> = ModuleContext<TConfig>;
export type ProvisionerContext<TConfig = Record<string, unknown>> = ModuleContext<TConfig>;

export type ConfigOf<S extends ZodObject> = z.infer<S>;

export function fetchWithTimeout(baseFetch: typeof fetch = fetch): FetchWithTimeout {
  return async (input, init = {}) => {
    const { timeoutMs = 30_000, signal, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    try {
      return await baseFetch(input, { ...rest, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface CreateContextOptions<TConfig> {
  config: TConfig;
  credentials?: Record<string, unknown>;
  logger: ModuleLogger;
  appUrl: string;
  webUrl: string;
  fetch?: typeof fetch;
}

export function createModuleContext<TConfig>(
  opts: CreateContextOptions<TConfig>,
): ModuleContext<TConfig> {
  return {
    config: opts.config,
    credentials: opts.credentials ?? {},
    logger: opts.logger,
    fetch: fetchWithTimeout(opts.fetch),
    appUrl: opts.appUrl,
    webUrl: opts.webUrl,
  };
}

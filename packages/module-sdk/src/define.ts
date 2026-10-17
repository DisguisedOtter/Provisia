import type { ZodObject } from 'zod';
import type { GatewayContext, ModuleContext } from './context.js';
import type { PaymentGateway, Provisioner, Registrar } from './types.js';

type Ctx<S extends ZodObject> = ModuleContext<import('zod').z.infer<S>>;
type GCtx<S extends ZodObject> = GatewayContext<import('zod').z.infer<S>>;

/** Replaces every `ctx: ModuleContext` parameter with the typed-config variant. */
type WithTypedCtx<T, C> = {
  [K in keyof T]: T[K] extends (ctx: infer _Old, ...args: infer A) => infer R
    ? (ctx: C, ...args: A) => R
    : T[K];
};

type TypedGateway<S extends ZodObject> = Omit<
  WithTypedCtx<PaymentGateway, GCtx<S>>,
  'configSchema'
> & {
  configSchema: S;
};
type TypedRegistrar<S extends ZodObject> = Omit<WithTypedCtx<Registrar, Ctx<S>>, 'configSchema'> & {
  configSchema: S;
};
type TypedProvisioner<S extends ZodObject> = Omit<
  WithTypedCtx<Provisioner, Ctx<S>>,
  'configSchema'
> & {
  configSchema: S;
};

/**
 * Typed authoring helpers. Inside the methods `ctx.config` is inferred from `configSchema`:
 *
 * ```ts
 * export default defineGateway({
 *   id: 'stripe', name: 'Stripe', version: '1.0.0',
 *   configSchema: z.object({ secretKey: z.string() }),
 *   capabilities: { refunds: true, savedMethods: true, recurring: true },
 *   async createPayment(ctx, invoice) { ctx.config.secretKey; ... },
 *   ...
 * });
 * ```
 */
export function defineGateway<S extends ZodObject>(gateway: TypedGateway<S>): PaymentGateway {
  return gateway as unknown as PaymentGateway;
}

export function defineRegistrar<S extends ZodObject>(registrar: TypedRegistrar<S>): Registrar {
  return registrar as unknown as Registrar;
}

export function defineProvisioner<S extends ZodObject>(
  provisioner: TypedProvisioner<S>,
): Provisioner {
  return provisioner as unknown as Provisioner;
}

import type { ModuleKind, PaymentGateway, Provisioner, Registrar } from '@provisia/module-sdk';
import { dataSchema } from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';

export const moduleKindSchema = z.enum(['gateway', 'registrar', 'provisioner']);

export const moduleDescriptorSchema = z.object({
  kind: moduleKindSchema,
  id: z.string(),
  name: z.string(),
  version: z.string(),
  /** Gateways: the declared capabilities; registrars/provisioners: which optional operations exist. */
  capabilities: z.record(z.string(), z.boolean()),
  /** JSON Schema (draft 2020-12) of `configSchema`, for dynamic admin forms. */
  configSchema: z.record(z.string(), z.unknown()),
  /** Config keys that are secrets (name contains secret/key/password/token); the UI renders them masked. */
  secretFields: z.array(z.string()),
});
export type ModuleDescriptor = z.infer<typeof moduleDescriptorSchema>;

const REGISTRAR_OPTIONAL = ['setContacts', 'setLock', 'getTldPricing'] as const;
const PROVISIONER_OPTIONAL = ['changePackage', 'changePassword', 'getUsage', 'loginUrl'] as const;
const SECRET_RE = /secret|password|passwd|token|api[_-]?key|private|credential/i;

export function describeModule(
  kind: ModuleKind,
  m: PaymentGateway | Registrar | Provisioner,
): ModuleDescriptor {
  let capabilities: Record<string, boolean> = {};
  if (kind === 'gateway') {
    capabilities = { ...(m as PaymentGateway).capabilities };
  } else if (kind === 'registrar') {
    for (const op of REGISTRAR_OPTIONAL)
      capabilities[op] = typeof (m as Registrar)[op] === 'function';
  } else {
    for (const op of PROVISIONER_OPTIONAL)
      capabilities[op] = typeof (m as Provisioner)[op] === 'function';
  }
  const configSchema = z.toJSONSchema(m.configSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  const secretFields = Object.keys(m.configSchema.shape ?? {}).filter((k) => SECRET_RE.test(k));
  return {
    kind,
    id: m.id,
    name: m.name,
    version: m.version,
    capabilities,
    configSchema,
    secretFields,
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/modules',
    {
      preHandler: requirePermission('modules.read'),
      schema: {
        tags: ['modules'],
        summary: 'Installed plugin modules with capabilities and config JSON Schema',
        querystring: z.object({ kind: moduleKindSchema.optional() }),
        response: { 200: dataSchema(z.array(moduleDescriptorSchema)) },
      },
    },
    async (req) => {
      const kinds: ModuleKind[] = req.query.kind
        ? [req.query.kind]
        : ['gateway', 'registrar', 'provisioner'];
      const data: ModuleDescriptor[] = [];
      for (const kind of kinds)
        for (const m of app.modules.list(kind)) data.push(describeModule(kind, m));
      return { data };
    },
  );

  app.get(
    '/admin/modules/:kind/:id',
    {
      preHandler: requirePermission('modules.read'),
      schema: {
        tags: ['modules'],
        params: z.object({ kind: moduleKindSchema, id: z.string().max(100) }),
        response: { 200: dataSchema(moduleDescriptorSchema) },
      },
    },
    async (req) => {
      const m = app.modules.find(req.params.kind, req.params.id);
      if (!m) throw notFound('Module');
      return { data: describeModule(req.params.kind, m) };
    },
  );
};

export default routes;

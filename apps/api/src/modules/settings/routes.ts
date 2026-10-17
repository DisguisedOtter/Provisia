import {
  dataSchema,
  type PublicSettings,
  publicSettingsSchema,
  SETTINGS_GROUP_NAMES,
  type SettingsGroup,
  type SettingsGroupName,
  settingsGroupNameSchema,
  settingsGroups,
  updateSettingsGroupSchema,
} from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog, entityDiff } from '../../lib/activity-log.js';
import { requirePermission } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { getSettings, maskSecrets, saveSettingsGroup } from '../../lib/settings.js';

const groupParams = z.object({ group: settingsGroupNameSchema });
const anyGroupSchema = z.record(z.string(), z.unknown());

/** JSON Schema per group so the admin UI can render forms dynamically. */
function groupJsonSchemas() {
  const out: Record<string, unknown> = {};
  for (const g of SETTINGS_GROUP_NAMES) out[g] = z.toJSONSchema(settingsGroups[g], { io: 'input' });
  return out;
}

export async function getPublicSettings(
  db: Parameters<typeof getSettings>[0],
): Promise<PublicSettings> {
  const [company, localization, security] = await Promise.all([
    getSettings(db, 'company'),
    getSettings(db, 'localization'),
    getSettings(db, 'security'),
  ]);
  return {
    companyName: company.name,
    logoUrl: company.logoUrl,
    website: company.website,
    supportEmail: company.email,
    defaultLocale: localization.defaultLocale,
    availableLocales: localization.availableLocales,
    defaultCurrency: localization.defaultCurrency,
    timezone: localization.timezone,
    dateFormat: localization.dateFormat,
    allowRegistration: security.allowRegistration,
    requireEmailVerification: security.requireEmailVerification,
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/public/settings',
    {
      schema: {
        tags: ['public'],
        summary: 'Branding + locale needed before login',
        security: [],
        response: { 200: dataSchema(publicSettingsSchema) },
      },
    },
    async () => ({ data: await getPublicSettings(app.db) }),
  );

  app.get(
    '/admin/settings',
    {
      preHandler: requirePermission('settings.read'),
      schema: {
        tags: ['settings'],
        summary: 'Every settings group (secrets masked) plus JSON Schemas for dynamic forms',
        response: {
          200: z.object({
            data: z.record(z.string(), anyGroupSchema),
            schemas: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    async () => {
      const data: Record<string, Record<string, unknown>> = {};
      for (const g of SETTINGS_GROUP_NAMES) {
        data[g] = maskSecrets(g, await getSettings(app.db, g)) as Record<string, unknown>;
      }
      return { data, schemas: groupJsonSchemas() };
    },
  );

  app.get(
    '/admin/settings/:group',
    {
      preHandler: requirePermission('settings.read'),
      schema: {
        tags: ['settings'],
        summary: 'One settings group (secrets masked)',
        params: groupParams,
        response: { 200: z.object({ data: anyGroupSchema, schema: z.unknown() }) },
      },
    },
    async (req) => {
      const g = req.params.group;
      return {
        data: maskSecrets(g, await getSettings(app.db, g)) as Record<string, unknown>,
        schema: z.toJSONSchema(settingsGroups[g], { io: 'input' }),
      };
    },
  );

  app.put(
    '/admin/settings/:group',
    {
      preHandler: requirePermission('settings.manage'),
      schema: {
        tags: ['settings'],
        summary: 'Partial update of a group; send the mask value to keep a secret unchanged',
        params: groupParams,
        body: anyGroupSchema,
        response: { 200: dataSchema(anyGroupSchema) },
      },
    },
    async (req) => {
      const g: SettingsGroupName = req.params.group;
      const parsed = updateSettingsGroupSchema(g).safeParse(req.body);
      if (!parsed.success) {
        throw badRequest(
          'Invalid settings',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const { before, after, changedKeys } = await saveSettingsGroup(
        app.db,
        g,
        parsed.data as Partial<SettingsGroup<typeof g>>,
      );
      await activityLog(req, {
        action: 'settings.update',
        entityType: 'settings',
        diff: {
          group: g,
          changedKeys,
          ...entityDiff(before as Record<string, unknown>, after as Record<string, unknown>),
        },
      });
      return { data: after as Record<string, unknown> };
    },
  );
};

export default routes;

import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES } from '@provisia/shared';
import { loadEnv } from '@provisia/shared/env';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from './index.js';
import {
  productGroups,
  productPrices,
  products,
  roles,
  settings,
  taxRules,
  users,
} from './schema/index.js';

/**
 * EU standard VAT rates (percent). Verify against current law before relying on them in production.
 * Last reviewed: 2025.
 */
const EU_VAT_RATES: Record<string, string> = {
  AT: '20.00',
  BE: '21.00',
  BG: '20.00',
  HR: '25.00',
  CY: '19.00',
  CZ: '21.00',
  DK: '25.00',
  EE: '24.00',
  FI: '25.50',
  FR: '20.00',
  DE: '19.00',
  GR: '24.00',
  HU: '27.00',
  IE: '23.00',
  IT: '22.00',
  LV: '21.00',
  LT: '21.00',
  LU: '17.00',
  MT: '18.00',
  NL: '21.00',
  PL: '23.00',
  PT: '23.00',
  RO: '21.00',
  SK: '23.00',
  SI: '22.00',
  ES: '21.00',
  SE: '25.00',
};

export interface SeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  homeCountry?: string;
  log?: (msg: string) => void;
}

/** Idempotent: safe to run on an already-seeded database. */
export async function seed(db: Db, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const adminEmail = (
    opts.adminEmail ??
    process.env.SEED_ADMIN_EMAIL ??
    'admin@example.com'
  ).toLowerCase();
  const adminPassword = opts.adminPassword ?? process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';
  const homeCountry = opts.homeCountry ?? 'NL';

  await db.transaction(async (tx) => {
    // Admin user
    const [existingAdmin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail));
    if (!existingAdmin) {
      await tx.insert(users).values({
        email: adminEmail,
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        role: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        emailVerifiedAt: new Date(),
      });
      log(`created admin ${adminEmail}`);
    }

    // Default staff roles (Admin/Support/Billing); permissions editable, rows not deletable
    for (const r of DEFAULT_ROLES) {
      await tx
        .insert(roles)
        .values({
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          isSystem: true,
        })
        .onConflictDoNothing({ target: roles.name });
    }

    // Settings (keys match settingsSchema in @provisia/shared)
    const defaults: Record<string, unknown> = {
      'company.name': 'Provisia Demo Hosting',
      'company.country': homeCountry,
      'billing.currency': 'EUR',
      'billing.invoiceDaysBeforeDue': 14,
      'billing.paymentTermDays': 14,
      'billing.taxInclusive': false,
      'dunning.reminderDays': [0, 3, 7],
      'dunning.suspendAfterDays': 7,
      'dunning.terminateAfterDays': 30,
      'dunning.lateFee': { type: 'none', value: 0 },
    };
    for (const [key, value] of Object.entries(defaults)) {
      await tx.insert(settings).values({ key, value }).onConflictDoNothing();
    }

    // Tax rules: NL domestic (no reverse charge) + every other EU member (B2B reverse charge)
    const [anyRule] = await tx.select({ id: taxRules.id }).from(taxRules).limit(1);
    if (!anyRule) {
      await tx.insert(taxRules).values(
        Object.entries(EU_VAT_RATES).map(([country, rate]) => ({
          country,
          eu: true,
          rate,
          b2bReverseCharge: country !== homeCountry,
          validFrom: '2025-01-01',
        })),
      );
      log(`created ${Object.keys(EU_VAT_RATES).length} EU tax rules (home: ${homeCountry})`);
    }

    // Demo catalog
    const [group] = await tx
      .insert(productGroups)
      .values({ name: 'Shared Hosting', slug: 'shared-hosting', description: 'Linux web hosting' })
      .onConflictDoUpdate({ target: productGroups.slug, set: { name: 'Shared Hosting' } })
      .returning({ id: productGroups.id });
    if (!group) throw new Error('failed to upsert product group');

    const [product] = await tx
      .insert(products)
      .values({
        groupId: group.id,
        name: 'Starter Hosting',
        slug: 'starter-hosting',
        description: '10 GB SSD, 1 website, free SSL',
        type: 'hosting',
        requiresDomain: true,
      })
      .onConflictDoUpdate({ target: products.slug, set: { groupId: group.id } })
      .returning({ id: products.id });
    if (!product) throw new Error('failed to upsert product');

    const prices = [
      { billingCycle: 'monthly', recurring: 499, setupFee: 0 },
      { billingCycle: 'annually', recurring: 4990, setupFee: 0 },
    ] as const;
    for (const p of prices) {
      await tx
        .insert(productPrices)
        .values({ productId: product.id, currency: 'EUR', ...p })
        .onConflictDoNothing();
    }
    log('created demo product "Starter Hosting" (EUR 4.99/month)');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(url, { max: 1 });
  seed(db, { log: console.log })
    .then(() => console.log('seed complete'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(close);
}

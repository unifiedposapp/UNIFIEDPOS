// ─── PLATFORM BOOTSTRAP ──────────────────────────────────────────────────────
// Idempotent startup hooks that make the platform console usable without a
// destructive reseed. The live local database already holds demo data, so we
// cannot simply re-run seed.ts; instead these upsert the minimum platform
// records (a SUPER_ADMIN operator account and the default SaaS tiers) on boot.

import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

const isProduction = process.env.NODE_ENV === 'production';

// Development fallbacks. In production NOTHING is created unless the operator
// explicitly supplies both credentials via env, so we never bake a password
// into a real deployment.
const DEV_EMAIL = 'platform@unifiedpos.com';
const DEV_NAME = 'Platform Administrator';
const DEV_PASSWORD = 'Platform_2025';

/**
 * Ensure a single SUPER_ADMIN account exists. Upserts by email, so it is safe
 * to call on every boot. Returns the email when an account is present/created,
 * or null when production has no configured credentials (a deliberate no-op).
 */
export async function ensurePlatformAdmin(): Promise<string | null> {
  const email = process.env.PLATFORM_ADMIN_EMAIL || (!isProduction ? DEV_EMAIL : undefined);
  const password = process.env.PLATFORM_ADMIN_PASSWORD || (!isProduction ? DEV_PASSWORD : undefined);
  const name = process.env.PLATFORM_ADMIN_NAME || DEV_NAME;
  if (!email || !password) return null;

  const hashed = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN' } });
      console.log(`[platform] promoted ${email} to SUPER_ADMIN`);
    }
    return email;
  }

  await prisma.user.create({
    data: { email, name, password: hashed, role: 'SUPER_ADMIN', isActive: true },
  });
  console.log(`[platform] created SUPER_ADMIN account: ${email}`);
  if (!isProduction) {
    console.log('[platform] (development default credentials — set PLATFORM_ADMIN_EMAIL / _PASSWORD to override)');
  }
  return email;
}

// The default tiers the console offers tenants. Inserted only when the table is
// empty, so operator edits are never clobbered on restart.
const DEFAULT_PLANS = [
  { name: 'Starter', code: 'starter', priceMonthly: 39, trialDays: 14, features: ['1 location', 'Up to 2,000 SKUs', 'POS + receipts', 'Email support'] },
  { name: 'Growth', code: 'growth', priceMonthly: 119, trialDays: 14, features: ['3 locations', 'Unlimited SKUs', 'Inventory + purchasing', 'Loyalty & marketing', 'Priority support'] },
  { name: 'Scale', code: 'scale', priceMonthly: 299, trialDays: 14, features: ['Unlimited locations', 'Restaurant & storefront', 'Advanced analytics + AI', 'API & webhooks', 'Phone support'] },
  { name: 'Enterprise', code: 'enterprise', priceMonthly: 499, trialDays: 30, features: ['Everything in Scale', 'SSO / SCIM', 'Fiscalisation & multi-region', 'Dedicated success manager', '99.9% SLA'] },
];

/** Seed the default SaaS tiers if none exist yet. Idempotent. */
export async function ensureDefaultPlatformPlans(): Promise<number> {
  const count = await prisma.platformPlan.count();
  if (count > 0) return 0;
  await prisma.platformPlan.createMany({
    data: DEFAULT_PLANS.map((p) => ({
      name: p.name,
      code: p.code,
      priceMonthly: p.priceMonthly,
      interval: 'MONTH',
      trialDays: p.trialDays,
      features: JSON.stringify(p.features),
      active: true,
    })),
  });
  console.log(`[platform] seeded ${DEFAULT_PLANS.length} default platform plans`);
  return DEFAULT_PLANS.length;
}

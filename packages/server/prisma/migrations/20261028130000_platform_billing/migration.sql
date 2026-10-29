-- Platform billing (SaaS operator console): the schema has carried these since
-- the platform-completeness work, but no migration ever created them, so a
-- database built with `migrate deploy` alone had no platform_plans /
-- platform_payments and no billing columns on organizations.
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "platformPlanId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "trialEnd" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "platform_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "priceMonthly" DECIMAL(14,2) NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'MONTH',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL DEFAULT 'OTHER',
    "reference" TEXT,
    "periodCoveredUntil" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_plans_code_key" ON "platform_plans"("code");

-- CreateIndex
CREATE INDEX "platform_payments_organizationId_idx" ON "platform_payments"("organizationId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_platformPlanId_fkey" FOREIGN KEY ("platformPlanId") REFERENCES "platform_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

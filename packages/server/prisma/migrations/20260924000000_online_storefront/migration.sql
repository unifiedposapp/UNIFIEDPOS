-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "storefrontToken" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "replenishmentRunId" TEXT;

-- CreateTable
CREATE TABLE "storefronts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fulfillmentTypes" JSONB,
    "pickupSlotsJson" JSONB,
    "deliveryFee" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "payOnPickup" BOOLEAN NOT NULL DEFAULT true,
    "headerText" TEXT,
    "themeColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_slug_key" ON "storefronts"("slug");

-- CreateIndex
CREATE INDEX "storefronts_organizationId_isEnabled_idx" ON "storefronts"("organizationId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "orders_storefrontToken_key" ON "orders"("storefrontToken");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


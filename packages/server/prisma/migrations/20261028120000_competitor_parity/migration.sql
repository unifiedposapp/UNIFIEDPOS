-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ageRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isWeighed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minAge" INTEGER,
ADD COLUMN     "plu" TEXT,
ADD COLUMN     "unitOfMeasure" TEXT NOT NULL DEFAULT 'EACH';

-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "reserved" SET DEFAULT 0,
ALTER COLUMN "reserved" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "damaged" SET DEFAULT 0,
ALTER COLUMN "damaged" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "reorderPoint" SET DEFAULT 0,
ALTER COLUMN "reorderPoint" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "inventory_movements" ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "ageVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "ageVerifiedBy" TEXT,
ADD COLUMN     "appliedPromotions" JSONB,
ADD COLUMN     "isTab" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tabClosedAt" TIMESTAMP(3),
ADD COLUMN     "tableId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "uom" TEXT NOT NULL DEFAULT 'EACH',
ADD COLUMN     "weighed" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "captureMethod" TEXT,
ADD COLUMN     "terminalReaderId" TEXT,
ADD COLUMN     "tipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "ageVerificationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ageVerificationMinAge" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "ageVerificationRequireId" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "channels" TEXT[],
ADD COLUMN     "daysOfWeek" INTEGER[],
ADD COLUMN     "endMinute" INTEGER,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rule" JSONB,
ADD COLUMN     "stackable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startMinute" INTEGER;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "backorderedAt" TIMESTAMP(3),
ADD COLUMN     "backorderedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tierId" TEXT,
ADD COLUMN     "tierSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "kitchen_orders" ADD COLUMN     "firedAt" TIMESTAMP(3),
ADD COLUMN     "firedCourse" INTEGER,
ADD COLUMN     "heldUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "kitchen_order_items" ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "stationId" TEXT,
ADD COLUMN     "stationName" TEXT,
ADD COLUMN     "targetPrepMinutes" INTEGER;

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yieldQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "yieldUnit" TEXT NOT NULL DEFAULT 'EACH',
    "targetFoodCostPct" DECIMAL(5,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'EACH',
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "age_verifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT,
    "employeeId" TEXT,
    "deviceId" TEXT,
    "method" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "birthDate" TIMESTAMP(3),
    "documentType" TEXT,
    "documentLast4" TEXT,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "age_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_schedules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "employeeId" TEXT NOT NULL,
    "position" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_swap_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "fromEmployeeId" TEXT NOT NULL,
    "toEmployeeId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByEmployeeId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_availability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "employee_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VACATION',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decidedByEmployeeId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pool_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'HOURS',
    "roles" TEXT[],
    "rolePoints" JSONB,
    "includeCashTips" BOOLEAN NOT NULL DEFAULT true,
    "includeCardTips" BOOLEAN NOT NULL DEFAULT true,
    "minHoursPerShift" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_pool_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_distributions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "points" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalOvertimeHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalTips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalGross" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "csv" TEXT,
    "createdByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_readers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "stripeReaderId" TEXT,
    "deviceType" TEXT NOT NULL DEFAULT 'CHIPPER_2X',
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNREGISTERED',
    "ipAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_readers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "apiVersion" TEXT,
    "scopes" TEXT[],
    "locationMap" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_product_mappings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalSku" TEXT,
    "externalVariantId" TEXT,
    "lastPushedAt" TIMESTAMP(3),
    "syncHash" TEXT,

    CONSTRAINT "external_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sync_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "channel_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "employeeId" TEXT,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'EACH',
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "discountAmt" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmt" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOT',
    "categoryIds" TEXT[],
    "printerTarget" TEXT,
    "targetPrepMinutes" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_tiers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minLifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "pointsMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "perks" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "columns" TEXT[],
    "filters" JSONB,
    "groupBy" TEXT,
    "sortBy" TEXT,
    "sortDir" TEXT NOT NULL DEFAULT 'desc',
    "scheduleCron" TEXT,
    "recipients" TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "definitionId" TEXT,
    "name" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "error" TEXT,
    "requestedByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "customerId" TEXT,
    "employeeId" TEXT,
    "serviceProductId" TEXT,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "depositPaymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "assignedEmployeeId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'REPAIR',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "deviceLabel" TEXT,
    "problem" TEXT,
    "diagnosis" TEXT,
    "warrantyUntil" TIMESTAMP(3),
    "laborTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "partsTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_lines" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LABOR',
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "work_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_agreements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "startAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rateAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lateFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_lines" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rateUnit" TEXT NOT NULL DEFAULT 'DAY',
    "rate" DECIMAL(10,2) NOT NULL,
    "returnedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "condition" TEXT,

    CONSTRAINT "rental_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registerId" TEXT,
    "deviceId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'KIOSK',
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "displayOrderId" TEXT,
    "lastCart" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backorders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "orderId" TEXT,
    "customerId" TEXT,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'EACH',
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "fulfilledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backorders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_productId_key" ON "recipes"("productId");

-- CreateIndex
CREATE INDEX "recipes_organizationId_idx" ON "recipes"("organizationId");

-- CreateIndex
CREATE INDEX "recipe_lines_recipeId_idx" ON "recipe_lines"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_lines_componentProductId_idx" ON "recipe_lines"("componentProductId");

-- CreateIndex
CREATE INDEX "age_verifications_organizationId_verifiedAt_idx" ON "age_verifications"("organizationId", "verifiedAt");

-- CreateIndex
CREATE INDEX "age_verifications_orderId_idx" ON "age_verifications"("orderId");

-- CreateIndex
CREATE INDEX "shift_schedules_organizationId_startAt_idx" ON "shift_schedules"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "shift_schedules_employeeId_startAt_idx" ON "shift_schedules"("employeeId", "startAt");

-- CreateIndex
CREATE INDEX "shift_swap_requests_organizationId_status_idx" ON "shift_swap_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "employee_availability_employeeId_weekday_idx" ON "employee_availability"("employeeId", "weekday");

-- CreateIndex
CREATE INDEX "time_off_requests_organizationId_status_idx" ON "time_off_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "tip_pool_rules_organizationId_idx" ON "tip_pool_rules"("organizationId");

-- CreateIndex
CREATE INDEX "tip_distributions_organizationId_periodStart_idx" ON "tip_distributions"("organizationId", "periodStart");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_periodStart_idx" ON "payroll_runs"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_readers_stripeReaderId_key" ON "terminal_readers"("stripeReaderId");

-- CreateIndex
CREATE INDEX "terminal_readers_organizationId_status_idx" ON "terminal_readers"("organizationId", "status");

-- CreateIndex
CREATE INDEX "channel_connections_organizationId_idx" ON "channel_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_organizationId_provider_shopDomain_key" ON "channel_connections"("organizationId", "provider", "shopDomain");

-- CreateIndex
CREATE INDEX "external_product_mappings_organizationId_productId_idx" ON "external_product_mappings"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "external_product_mappings_channelId_productId_key" ON "external_product_mappings"("channelId", "productId");

-- CreateIndex
CREATE INDEX "channel_sync_logs_organizationId_startedAt_idx" ON "channel_sync_logs"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quoteNumber_key" ON "quotes"("quoteNumber");

-- CreateIndex
CREATE INDEX "quotes_organizationId_status_idx" ON "quotes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "quote_lines_quoteId_idx" ON "quote_lines"("quoteId");

-- CreateIndex
CREATE INDEX "kitchen_stations_organizationId_idx" ON "kitchen_stations"("organizationId");

-- CreateIndex
CREATE INDEX "loyalty_tiers_organizationId_programId_idx" ON "loyalty_tiers"("organizationId", "programId");

-- CreateIndex
CREATE INDEX "report_definitions_organizationId_idx" ON "report_definitions"("organizationId");

-- CreateIndex
CREATE INDEX "report_runs_organizationId_createdAt_idx" ON "report_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "appointments_organizationId_startAt_idx" ON "appointments"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "appointments_employeeId_startAt_idx" ON "appointments"("employeeId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_number_key" ON "work_orders"("number");

-- CreateIndex
CREATE INDEX "work_orders_organizationId_status_idx" ON "work_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "work_order_lines_workOrderId_idx" ON "work_order_lines"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_agreements_number_key" ON "rental_agreements"("number");

-- CreateIndex
CREATE INDEX "rental_agreements_organizationId_status_idx" ON "rental_agreements"("organizationId", "status");

-- CreateIndex
CREATE INDEX "rental_lines_agreementId_idx" ON "rental_lines"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_sessions_token_key" ON "kiosk_sessions"("token");

-- CreateIndex
CREATE INDEX "kiosk_sessions_organizationId_mode_idx" ON "kiosk_sessions"("organizationId", "mode");

-- CreateIndex
CREATE INDEX "backorders_organizationId_status_idx" ON "backorders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "backorders_organizationId_productId_idx" ON "backorders"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "backorders_customerId_idx" ON "backorders"("customerId");

-- CreateIndex
CREATE INDEX "orders_organizationId_tableId_idx" ON "orders"("organizationId", "tableId");

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_lines" ADD CONSTRAINT "rental_lines_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "rental_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;


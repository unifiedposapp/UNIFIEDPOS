-- ─── Global expansion wave: fiscalization, local rails, agentic ops, verticals,
-- ─── embedded finance, agentic commerce, store mesh, franchise, ecosystem,
-- ─── peer benchmarking. 17 new tables, no changes to existing columns.

-- CreateTable: fiscal_devices
CREATE TABLE "fiscal_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "profileCode" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "activationCode" TEXT,
    "publicKeyRef" TEXT,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "lastSignedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fiscal_documents
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "deviceId" TEXT,
    "profileCode" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'RECEIPT',
    "receiptNumber" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "total" DECIMAL(12,2) NOT NULL,
    "vatTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payloadHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "signedHash" TEXT,
    "qrPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SEALED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "errorMessage" TEXT,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transmittedAt" TIMESTAMP(3),

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: rail_accounts
CREATE TABLE "rail_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "railCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "holderName" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "validationNote" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: settlement_batches
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "railCode" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'INTERNAL',
    "batchDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "matchedNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "variance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "discrepancyDetail" JSONB,
    "signedOffBy" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: settlement_lines
CREATE TABLE "settlement_lines" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalReference" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED_PROVIDER',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable: replenishment_runs
CREATE TABLE "replenishment_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "horizonDays" INTEGER NOT NULL DEFAULT 14,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "supplierCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "plan" JSONB,
    "guardrails" JSONB,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "purchaseOrderIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: vertical_installations
CREATE TABLE "vertical_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "solutionCode" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "status" TEXT NOT NULL DEFAULT 'INSTALLED',
    "features" JSONB,
    "config" JSONB,
    "posHints" JSONB,
    "appliedDelta" JSONB,
    "enabledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vertical_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_facilities
CREATE TABLE "credit_facilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "drawnAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "termMonths" INTEGER NOT NULL DEFAULT 6,
    "installmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sweepPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreBand" TEXT,
    "underwriting" JSONB,
    "eligibility" JSONB,
    "nextDueDate" TIMESTAMP(3),
    "lastSweepAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable: loan_repayments
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agent_mandates
CREATE TABLE "agent_mandates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT,
    "principalEmail" TEXT,
    "mandateType" TEXT NOT NULL DEFAULT 'PURCHASE',
    "items" JSONB NOT NULL,
    "ceilingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "nonce" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureAlg" TEXT NOT NULL DEFAULT 'HMAC-SHA256',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rejectReason" TEXT,
    "orderId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mesh_fences
CREATE TABLE "mesh_fences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "leaderDeviceId" TEXT,
    "previousLeaderId" TEXT,
    "committedSequence" INTEGER NOT NULL DEFAULT 0,
    "leaseSeconds" INTEGER NOT NULL DEFAULT 30,
    "lastCommitAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_fences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: franchise_agreements
CREATE TABLE "franchise_agreements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "franchiseeName" TEXT NOT NULL,
    "locationId" TEXT,
    "royaltyModel" TEXT NOT NULL DEFAULT 'PERCENT',
    "royaltyPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tiers" JSONB,
    "perItemFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedMonthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimumMonthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marketingFundPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "transferMarkupPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "exclusions" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: royalty_accruals
CREATE TABLE "royalty_accruals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "locationId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableBase" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "royaltyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marketingFundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimumApplied" BOOLEAN NOT NULL DEFAULT false,
    "calculation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "royalty_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: app_installations
CREATE TABLE "app_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "publisher" TEXT,
    "categories" JSONB,
    "scopes" JSONB NOT NULL,
    "config" JSONB,
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INSTALLED',
    "installedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: custom_field_definitions
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'ORDER',
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: custom_field_values
CREATE TABLE "custom_field_values" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "entityUuid" TEXT NOT NULL,
    "textValue" TEXT,
    "numberValue" DECIMAL(14,4),
    "boolValue" BOOLEAN,
    "dateValue" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable: benchmark_snapshots
CREATE TABLE "benchmark_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "industry" TEXT NOT NULL DEFAULT 'RETAIL',
    "metricKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cohortSize" INTEGER NOT NULL DEFAULT 0,
    "kValue" INTEGER NOT NULL DEFAULT 5,
    "publishable" BOOLEAN NOT NULL DEFAULT false,
    "median" DECIMAL(14,4),
    "p10" DECIMAL(14,4),
    "p25" DECIMAL(14,4),
    "p75" DECIMAL(14,4),
    "p90" DECIMAL(14,4),
    "noiseApplied" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "distribution" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_devices_organizationId_serialNumber_key" ON "fiscal_devices"("organizationId", "serialNumber");
CREATE INDEX "fiscal_devices_organizationId_status_idx" ON "fiscal_devices"("organizationId", "status");
CREATE UNIQUE INDEX "fiscal_documents_organizationId_profileCode_receiptNumber_key" ON "fiscal_documents"("organizationId", "profileCode", "receiptNumber");
CREATE INDEX "fiscal_documents_organizationId_status_nextRetryAt_idx" ON "fiscal_documents"("organizationId", "status", "nextRetryAt");
CREATE INDEX "fiscal_documents_organizationId_orderId_idx" ON "fiscal_documents"("organizationId", "orderId");
CREATE UNIQUE INDEX "rail_accounts_organizationId_railCode_identifier_key" ON "rail_accounts"("organizationId", "railCode", "identifier");
CREATE INDEX "rail_accounts_organizationId_countryCode_idx" ON "rail_accounts"("organizationId", "countryCode");
CREATE INDEX "settlement_batches_organizationId_status_idx" ON "settlement_batches"("organizationId", "status");
CREATE INDEX "settlement_batches_organizationId_batchDate_idx" ON "settlement_batches"("organizationId", "batchDate");
CREATE INDEX "settlement_lines_batchId_status_idx" ON "settlement_lines"("batchId", "status");
CREATE INDEX "settlement_lines_organizationId_externalReference_idx" ON "settlement_lines"("organizationId", "externalReference");
CREATE INDEX "replenishment_runs_organizationId_status_idx" ON "replenishment_runs"("organizationId", "status");
CREATE UNIQUE INDEX "vertical_installations_organizationId_solutionCode_key" ON "vertical_installations"("organizationId", "solutionCode");
CREATE INDEX "vertical_installations_organizationId_status_idx" ON "vertical_installations"("organizationId", "status");
CREATE INDEX "credit_facilities_organizationId_status_idx" ON "credit_facilities"("organizationId", "status");
CREATE UNIQUE INDEX "loan_repayments_facilityId_period_key" ON "loan_repayments"("facilityId", "period");
CREATE INDEX "loan_repayments_organizationId_status_dueDate_idx" ON "loan_repayments"("organizationId", "status", "dueDate");
CREATE UNIQUE INDEX "agent_mandates_nonce_key" ON "agent_mandates"("nonce");
CREATE INDEX "agent_mandates_organizationId_status_idx" ON "agent_mandates"("organizationId", "status");
CREATE INDEX "agent_mandates_organizationId_agentId_idx" ON "agent_mandates"("organizationId", "agentId");
CREATE UNIQUE INDEX "mesh_fences_organizationId_locationId_key" ON "mesh_fences"("organizationId", "locationId");
CREATE UNIQUE INDEX "franchise_agreements_organizationId_entityCode_key" ON "franchise_agreements"("organizationId", "entityCode");
CREATE INDEX "franchise_agreements_organizationId_status_idx" ON "franchise_agreements"("organizationId", "status");
CREATE UNIQUE INDEX "royalty_accruals_agreementId_periodStart_key" ON "royalty_accruals"("agreementId", "periodStart");
CREATE INDEX "royalty_accruals_organizationId_status_idx" ON "royalty_accruals"("organizationId", "status");
CREATE UNIQUE INDEX "app_installations_organizationId_appCode_key" ON "app_installations"("organizationId", "appCode");
CREATE INDEX "app_installations_organizationId_status_idx" ON "app_installations"("organizationId", "status");
CREATE UNIQUE INDEX "custom_field_definitions_organizationId_entity_fieldKey_key" ON "custom_field_definitions"("organizationId", "entity", "fieldKey");
CREATE INDEX "custom_field_definitions_organizationId_entity_active_idx" ON "custom_field_definitions"("organizationId", "entity", "active");
CREATE UNIQUE INDEX "custom_field_values_fieldId_entityUuid_key" ON "custom_field_values"("fieldId", "entityUuid");
CREATE INDEX "custom_field_values_organizationId_entityUuid_idx" ON "custom_field_values"("organizationId", "entityUuid");
CREATE INDEX "benchmark_snapshots_countryCode_industry_metricKey_idx" ON "benchmark_snapshots"("countryCode", "industry", "metricKey");
CREATE INDEX "benchmark_snapshots_organizationId_metricKey_idx" ON "benchmark_snapshots"("organizationId", "metricKey");

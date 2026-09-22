-- AlterTable: individual cashier register PIN (bcrypt hash) + brute-force counters
ALTER TABLE "employees" ADD COLUMN     "registerPin" TEXT,
ADD COLUMN     "pinUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);

-- AlterTable: drawer handover lock on the register session
ALTER TABLE "register_sessions" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockReason" TEXT,
ADD COLUMN     "lockedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: org-level auto-lock policy (minutes of cashier inactivity)
ALTER TABLE "store_settings" ADD COLUMN     "registerIdleLockMinutes" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex: fast "does this cashier already hold an open drawer?" lookup
CREATE INDEX "register_sessions_employeeId_status_idx" ON "register_sessions"("employeeId", "status");

-- CreateIndex: fast "is this register occupied by someone else?" lookup
CREATE INDEX "register_sessions_registerId_status_idx" ON "register_sessions"("registerId", "status");

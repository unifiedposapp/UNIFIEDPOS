-- AlterTable: add a first-class product type (Physical / Service / Digital /
-- Gift Card / Non-inventory). Defaults to 'PHYSICAL' so every existing product
-- remains stock-tracked after the migration.
ALTER TABLE "products" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'PHYSICAL';

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('customer', 'manual_print', 'print_simulator');

-- AlterTable: add source column with default for existing rows
ALTER TABLE "Order" ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'customer';

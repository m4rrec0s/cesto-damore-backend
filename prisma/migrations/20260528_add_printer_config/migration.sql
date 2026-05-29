-- CreateEnum
CREATE TYPE "PrinterRole" AS ENUM ('photo', 'letter');

-- CreateTable
CREATE TABLE "printer_config" (
    "id" TEXT NOT NULL,
    "role" "PrinterRole" NOT NULL,
    "printerName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "printer_config_role_key" ON "printer_config"("role");

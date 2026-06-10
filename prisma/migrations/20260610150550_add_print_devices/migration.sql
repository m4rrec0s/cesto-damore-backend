-- CreateTable
CREATE TABLE "print_devices" (
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ip" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printers" JSONB NOT NULL DEFAULT '[]',
    "token" TEXT NOT NULL DEFAULT gen_random_uuid(),

    CONSTRAINT "print_devices_pkey" PRIMARY KEY ("deviceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_devices_token_key" ON "print_devices"("token");

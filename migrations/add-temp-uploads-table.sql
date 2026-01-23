-- CreateTable TempUpload (para armazenar metadados de uploads temporários)
CREATE TABLE IF NOT EXISTS "TempUpload" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "filename" TEXT NOT NULL UNIQUE,
  "originalName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "userId" TEXT,
  "orderId" TEXT,
  
  CONSTRAINT "TempUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS "TempUpload_expiresAt_idx" ON "TempUpload"("expiresAt");
CREATE INDEX IF NOT EXISTS "TempUpload_userId_idx" ON "TempUpload"("userId");
CREATE INDEX IF NOT EXISTS "TempUpload_orderId_idx" ON "TempUpload"("orderId");
CREATE INDEX IF NOT EXISTS "TempUpload_deletedAt_idx" ON "TempUpload"("deletedAt");

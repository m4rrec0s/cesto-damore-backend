CREATE TABLE "agent_version" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "version" TEXT NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "releaseNotes" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_version_pkey" PRIMARY KEY ("id")
);

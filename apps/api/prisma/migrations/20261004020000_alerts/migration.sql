CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "AlertRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minSeverity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlertRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "deliveries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");
CREATE INDEX "AlertEvent_dedupeKey_createdAt_idx" ON "AlertEvent"("dedupeKey", "createdAt");

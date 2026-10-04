ALTER TABLE "Device" ADD COLUMN "hostname" TEXT;

CREATE TABLE "UsageHourly" (
    "hour" TIMESTAMP(3) NOT NULL,
    "macAddress" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "bytesDown" BIGINT NOT NULL DEFAULT 0,
    "bytesUp" BIGINT NOT NULL DEFAULT 0,
    "voucherId" TEXT,

    CONSTRAINT "UsageHourly_pkey" PRIMARY KEY ("hour","macAddress","app")
);

CREATE INDEX "UsageHourly_hour_idx" ON "UsageHourly"("hour");
CREATE INDEX "UsageHourly_macAddress_hour_idx" ON "UsageHourly"("macAddress", "hour");

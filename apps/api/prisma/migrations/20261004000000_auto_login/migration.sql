-- Remember which WiFi device started a payment, so a successful payment can
-- admit that device even if the customer left the portal while paying.
ALTER TABLE "Payment" ADD COLUMN "macAddress" TEXT;
ALTER TABLE "Payment" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "Payment" ADD COLUMN "routerId" TEXT;
CREATE INDEX "Payment_macAddress_idx" ON "Payment"("macAddress");

-- A device slot handed over to a newer device on the same voucher.
ALTER TABLE "Device" ADD COLUMN "releasedAt" TIMESTAMP(3);

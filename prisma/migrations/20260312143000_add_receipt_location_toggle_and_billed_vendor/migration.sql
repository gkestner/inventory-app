ALTER TABLE "Location"
ADD COLUMN "receiptEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ReceiptEntry"
ADD COLUMN "billedBackVendor" TEXT;

CREATE INDEX "Location_receiptEnabled_idx" ON "Location"("receiptEnabled");

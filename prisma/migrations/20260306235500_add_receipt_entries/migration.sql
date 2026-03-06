-- Add receipt data entry tables for maintenance users.
CREATE TABLE "ReceiptEntry" (
  "id" TEXT NOT NULL,
  "receiptDate" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceiptEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceiptEntryArea" (
  "receiptEntryId" TEXT NOT NULL,
  "area" "EquipmentArea" NOT NULL,
  CONSTRAINT "ReceiptEntryArea_pkey" PRIMARY KEY ("receiptEntryId", "area")
);

CREATE INDEX "ReceiptEntry_receiptDate_createdAt_idx" ON "ReceiptEntry"("receiptDate", "createdAt");
CREATE INDEX "ReceiptEntry_locationId_receiptDate_idx" ON "ReceiptEntry"("locationId", "receiptDate");
CREATE INDEX "ReceiptEntry_createdByUserId_createdAt_idx" ON "ReceiptEntry"("createdByUserId", "createdAt");

ALTER TABLE "ReceiptEntry"
  ADD CONSTRAINT "ReceiptEntry_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReceiptEntry"
  ADD CONSTRAINT "ReceiptEntry_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReceiptEntryArea"
  ADD CONSTRAINT "ReceiptEntryArea_receiptEntryId_fkey"
  FOREIGN KEY ("receiptEntryId") REFERENCES "ReceiptEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

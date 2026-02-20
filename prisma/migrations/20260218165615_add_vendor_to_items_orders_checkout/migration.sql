-- AlterTable
ALTER TABLE "InventoryOrder" ADD COLUMN     "vendor" "InvoiceVendor" NOT NULL DEFAULT 'SUCCESS_PLUS';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "vendor" "InvoiceVendor" NOT NULL DEFAULT 'SUCCESS_PLUS';

-- AlterTable
ALTER TABLE "ItemVersion" ADD COLUMN     "vendor" "InvoiceVendor" NOT NULL DEFAULT 'SUCCESS_PLUS';

-- AlterTable
ALTER TABLE "PartsCheckoutTicket" ADD COLUMN     "vendorSnapshot" "InvoiceVendor" NOT NULL DEFAULT 'SUCCESS_PLUS';

-- CreateTable
CREATE TABLE "InvoiceVendorConfig" (
    "vendor" "InvoiceVendor" NOT NULL,
    "partsUpchargePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceVendorConfig_pkey" PRIMARY KEY ("vendor")
);

-- CreateIndex
CREATE INDEX "InventoryOrder_vendor_orderedAt_idx" ON "InventoryOrder"("vendor", "orderedAt");

-- CreateIndex
CREATE INDEX "Item_vendor_idx" ON "Item"("vendor");

-- CreateIndex
CREATE INDEX "PartsCheckoutTicket_vendorSnapshot_createdAt_idx" ON "PartsCheckoutTicket"("vendorSnapshot", "createdAt");

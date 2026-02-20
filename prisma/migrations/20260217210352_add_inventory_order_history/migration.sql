-- CreateEnum
CREATE TYPE "InventoryOrderStatus" AS ENUM ('ORDERED', 'ARRIVED', 'ADDED_TO_INVENTORY');

-- CreateTable
CREATE TABLE "InventoryOrder" (
    "id" TEXT NOT NULL,
    "status" "InventoryOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supplierName" TEXT,
    "supplierPartNumber" TEXT,
    "unitPrice" DECIMAL(10,2),
    "shippingCost" DECIMAL(10,2),
    "taxCost" DECIMAL(10,2),
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedAt" TIMESTAMP(3),
    "addedToInventoryAt" TIMESTAMP(3),
    "forStoreId" TEXT,
    "forUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryOrder_status_orderedAt_idx" ON "InventoryOrder"("status", "orderedAt");

-- CreateIndex
CREATE INDEX "InventoryOrder_itemId_orderedAt_idx" ON "InventoryOrder"("itemId", "orderedAt");

-- CreateIndex
CREATE INDEX "InventoryOrder_forStoreId_orderedAt_idx" ON "InventoryOrder"("forStoreId", "orderedAt");

-- CreateIndex
CREATE INDEX "InventoryOrder_forUserId_orderedAt_idx" ON "InventoryOrder"("forUserId", "orderedAt");

-- CreateIndex
CREATE INDEX "InventoryOrder_createdByUserId_orderedAt_idx" ON "InventoryOrder"("createdByUserId", "orderedAt");

-- AddForeignKey
ALTER TABLE "InventoryOrder" ADD CONSTRAINT "InventoryOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryOrder" ADD CONSTRAINT "InventoryOrder_forStoreId_fkey" FOREIGN KEY ("forStoreId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryOrder" ADD CONSTRAINT "InventoryOrder_forUserId_fkey" FOREIGN KEY ("forUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryOrder" ADD CONSTRAINT "InventoryOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

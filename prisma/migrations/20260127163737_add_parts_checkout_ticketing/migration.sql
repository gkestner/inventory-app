-- CreateEnum
CREATE TYPE "InventoryAlertType" AS ENUM ('NEGATIVE_ON_HAND', 'BELOW_MIN', 'TECH_REQUEST_ORDER');

-- CreateEnum
CREATE TYPE "PartsCheckoutStatus" AS ENUM ('OPEN', 'INVOICED', 'VOIDED');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "minQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onHandQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "usedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ItemVersion" ADD COLUMN     "minQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onHandQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "usedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryAlert" (
    "id" TEXT NOT NULL,
    "type" "InventoryAlertType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeId" TEXT,
    "storeName" TEXT,
    "checkoutId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "qtyDelta" INTEGER,
    "onHandAfter" INTEGER,
    "orderedAfter" INTEGER,
    "availableAfter" INTEGER,
    "minQtyAtTime" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "InventoryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartsCheckoutTicket" (
    "id" TEXT NOT NULL,
    "status" "PartsCheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "itemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "needToOrderMore" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "note" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "partNumberSnapshot" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "costSnapshot" DECIMAL(10,2),
    "priceSnapshot" DECIMAL(10,2),
    "taxableSnapshot" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoicedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidNote" TEXT,

    CONSTRAINT "PartsCheckoutTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAlert_itemId_createdAt_idx" ON "InventoryAlert"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryAlert_type_createdAt_idx" ON "InventoryAlert"("type", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryAlert_resolvedAt_idx" ON "InventoryAlert"("resolvedAt");

-- CreateIndex
CREATE INDEX "InventoryAlert_checkoutId_idx" ON "InventoryAlert"("checkoutId");

-- CreateIndex
CREATE INDEX "PartsCheckoutTicket_status_createdAt_idx" ON "PartsCheckoutTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartsCheckoutTicket_storeId_createdAt_idx" ON "PartsCheckoutTicket"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "PartsCheckoutTicket_itemId_createdAt_idx" ON "PartsCheckoutTicket"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "PartsCheckoutTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsCheckoutTicket" ADD CONSTRAINT "PartsCheckoutTicket_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsCheckoutTicket" ADD CONSTRAINT "PartsCheckoutTicket_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsCheckoutTicket" ADD CONSTRAINT "PartsCheckoutTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "InventoryOrder" ADD COLUMN     "hiddenFromUserLiveBoard" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "InventoryOrder_hiddenFromUserLiveBoard_orderedAt_idx" ON "InventoryOrder"("hiddenFromUserLiveBoard", "orderedAt");

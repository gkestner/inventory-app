ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS 'GENERAL_BUILDING_MAINTENANCE';
ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS 'GREASE_TRAPS';
ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS 'EQUIPMENT_FILTERS';

CREATE TABLE "EquipmentAreaChecklistItem" (
    "id" TEXT NOT NULL,
    "area" "EquipmentArea" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAreaChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkOrderChecklistSelection" (
    "workOrderId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "labelSnapshot" TEXT NOT NULL,
    "area" "EquipmentArea" NOT NULL,

    CONSTRAINT "WorkOrderChecklistSelection_pkey" PRIMARY KEY ("workOrderId","checklistItemId")
);

CREATE TABLE "InventoryItemComment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItemComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EquipmentAreaChecklistItem_area_active_sortOrder_idx" ON "EquipmentAreaChecklistItem"("area", "active", "sortOrder");
CREATE INDEX "EquipmentAreaChecklistItem_area_label_idx" ON "EquipmentAreaChecklistItem"("area", "label");
CREATE INDEX "WorkOrderChecklistSelection_checklistItemId_idx" ON "WorkOrderChecklistSelection"("checklistItemId");
CREATE INDEX "WorkOrderChecklistSelection_area_idx" ON "WorkOrderChecklistSelection"("area");
CREATE UNIQUE INDEX "InventoryItemComment_itemId_userId_key" ON "InventoryItemComment"("itemId", "userId");
CREATE INDEX "InventoryItemComment_itemId_updatedAt_idx" ON "InventoryItemComment"("itemId", "updatedAt");
CREATE INDEX "InventoryItemComment_userId_updatedAt_idx" ON "InventoryItemComment"("userId", "updatedAt");

ALTER TABLE "WorkOrderChecklistSelection" ADD CONSTRAINT "WorkOrderChecklistSelection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderChecklistSelection" ADD CONSTRAINT "WorkOrderChecklistSelection_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "EquipmentAreaChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItemComment" ADD CONSTRAINT "InventoryItemComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItemComment" ADD CONSTRAINT "InventoryItemComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
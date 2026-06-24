CREATE TABLE "WorkOrderEquipmentCategory" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderEquipmentCategory_pkey" PRIMARY KEY ("key")
);

INSERT INTO "WorkOrderEquipmentCategory" ("key", "label", "sortOrder", "active", "updatedAt")
VALUES
    ('DOUGH_ROLLER', 'Dough Roller', 10, true, CURRENT_TIMESTAMP),
    ('MAKETABLE', 'Make Table', 20, true, CURRENT_TIMESTAMP),
    ('DOUGH_COOLER', 'Dough Cooler', 30, true, CURRENT_TIMESTAMP),
    ('MIXER', 'Mixer', 40, true, CURRENT_TIMESTAMP),
    ('OVEN', 'Oven', 50, true, CURRENT_TIMESTAMP),
    ('WALK_IN', 'Walk In', 60, true, CURRENT_TIMESTAMP),
    ('FREEZER', 'Freezer', 70, true, CURRENT_TIMESTAMP),
    ('BUILDING_STRUCTURE', 'Building Structure', 80, true, CURRENT_TIMESTAMP),
    ('GENERAL_BUILDING_MAINTENANCE', 'General Building Maintenance', 90, true, CURRENT_TIMESTAMP),
    ('GREASE_TRAPS', 'Grease Traps', 100, true, CURRENT_TIMESTAMP),
    ('EQUIPMENT_FILTERS', 'Equipment Filters', 110, true, CURRENT_TIMESTAMP),
    ('LIGHTING', 'Lighting', 120, true, CURRENT_TIMESTAMP),
    ('PARKING_LOT', 'Parking Lot', 130, true, CURRENT_TIMESTAMP),
    ('OFFICE', 'Office', 140, true, CURRENT_TIMESTAMP),
    ('PLUMBING', 'Plumbing', 150, true, CURRENT_TIMESTAMP),
    ('HVAC_GAME_ROOM', 'HVAC Game Room', 160, true, CURRENT_TIMESTAMP),
    ('HVAC_KITCHEN', 'HVAC Kitchen', 170, true, CURRENT_TIMESTAMP),
    ('HVAC_DINING_ROOM', 'HVAC Dining Room', 180, true, CURRENT_TIMESTAMP),
    ('OTHER', 'Other', 190, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE INDEX "WorkOrderEquipmentCategory_active_sortOrder_label_idx" ON "WorkOrderEquipmentCategory"("active", "sortOrder", "label");

ALTER TABLE "EquipmentAreaChecklistItem" ALTER COLUMN "area" TYPE TEXT USING "area"::TEXT;
ALTER TABLE "WorkOrderEquipmentArea" ALTER COLUMN "area" TYPE TEXT USING "area"::TEXT;
ALTER TABLE "WorkOrderChecklistSelection" ALTER COLUMN "area" TYPE TEXT USING "area"::TEXT;
ALTER TABLE "ReceiptEntryArea" ALTER COLUMN "area" TYPE TEXT USING "area"::TEXT;

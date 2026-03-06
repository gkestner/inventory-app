-- Equipment tracking logs by location and section
CREATE TABLE "EquipmentTrackingLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "ngOrLp" TEXT,
    "iceCream" TEXT,
    "greaseTrapSize" TEXT,
    "modelNumber" TEXT,
    "serialNumber" TEXT,
    "manufacturer" TEXT,
    "color" TEXT,
    "freonType" TEXT,
    "notes" TEXT,
    "pepsiMachineOrBin" TEXT,
    "tanklessOrTank" TEXT,
    "condenserUnitNumber" TEXT,
    "evaporatorUnitNumber" TEXT,
    "tonnage" TEXT,
    "size" TEXT,
    "freezerType" TEXT,
    "letterSize" TEXT,
    "signType" TEXT,
    "amountOfHeads" TEXT,
    "cameraCount" TEXT,
    "lpOrNg" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EquipmentTrackingLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentTrackingLog_locationId_sectionKey_key"
ON "EquipmentTrackingLog"("locationId", "sectionKey");

CREATE INDEX "EquipmentTrackingLog_sectionKey_idx"
ON "EquipmentTrackingLog"("sectionKey");

CREATE INDEX "EquipmentTrackingLog_updatedByUserId_idx"
ON "EquipmentTrackingLog"("updatedByUserId");

ALTER TABLE "EquipmentTrackingLog"
ADD CONSTRAINT "EquipmentTrackingLog_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentTrackingLog"
ADD CONSTRAINT "EquipmentTrackingLog_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

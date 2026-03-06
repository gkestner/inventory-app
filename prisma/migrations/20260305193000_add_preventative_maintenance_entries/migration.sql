-- Preventative maintenance yearly matrix by location
CREATE TABLE "PreventativeMaintenanceEntry" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "locationId" TEXT NOT NULL,
    "ovenCleaning" TEXT,
    "exhaustFanMotor" TEXT,
    "tanklessWaterHeater" TEXT,
    "iceMaker" TEXT,
    "greaseTrapGallons" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreventativeMaintenanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreventativeMaintenanceEntry_locationId_year_key"
ON "PreventativeMaintenanceEntry"("locationId", "year");

CREATE INDEX "PreventativeMaintenanceEntry_year_idx"
ON "PreventativeMaintenanceEntry"("year");

CREATE INDEX "PreventativeMaintenanceEntry_updatedByUserId_idx"
ON "PreventativeMaintenanceEntry"("updatedByUserId");

ALTER TABLE "PreventativeMaintenanceEntry"
ADD CONSTRAINT "PreventativeMaintenanceEntry_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PreventativeMaintenanceEntry"
ADD CONSTRAINT "PreventativeMaintenanceEntry_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

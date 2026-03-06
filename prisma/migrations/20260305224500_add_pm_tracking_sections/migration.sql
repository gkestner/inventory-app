-- Add additional PM tracking sections per location/year
ALTER TABLE "PreventativeMaintenanceEntry"
ADD COLUMN "greaseTrapTankSize" TEXT,
ADD COLUMN "greaseTrapDatePumped" TEXT,
ADD COLUMN "greaseTrapCompany" TEXT,
ADD COLUMN "greaseTrapCost" TEXT,
ADD COLUMN "backflowDateChecked" TEXT,
ADD COLUMN "backflowCompany" TEXT,
ADD COLUMN "backflowAmount" TEXT,
ADD COLUMN "boilerInspectionDatePrimary" TEXT,
ADD COLUMN "boilerInspectionCompany" TEXT,
ADD COLUMN "boilerInspectionDateSecondary" TEXT;

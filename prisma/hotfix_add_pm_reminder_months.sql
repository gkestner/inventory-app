ALTER TABLE "PreventativeMaintenanceEntry"
  ADD COLUMN IF NOT EXISTS "greaseTrapReminderMonths" TEXT,
  ADD COLUMN IF NOT EXISTS "backflowReminderMonths" TEXT,
  ADD COLUMN IF NOT EXISTS "boilerInspectionReminderMonths" TEXT;

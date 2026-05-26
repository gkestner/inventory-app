-- Adds configurable cap for min-qty ramp-down safety.
ALTER TABLE "AppConfig"
ADD COLUMN IF NOT EXISTS "minQtyRampDownMaxReductionPer30DaysPct" INTEGER NOT NULL DEFAULT 10;

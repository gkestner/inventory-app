ALTER TABLE "AppConfig"
ADD COLUMN IF NOT EXISTS "minQtyRampDownMaxReductionPer30DaysPct" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "AppConfig"
ADD COLUMN "minQtyForecastMonths" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "AppConfig"
ADD CONSTRAINT "AppConfig_minQtyForecastMonths_range"
CHECK ("minQtyForecastMonths" BETWEEN 1 AND 1200);

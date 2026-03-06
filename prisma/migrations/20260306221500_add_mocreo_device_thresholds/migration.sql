-- Add per-sensor thresholds for Mocreo devices.
ALTER TABLE "MocreoDevice"
  ADD COLUMN "minTempF" DECIMAL(6,2),
  ADD COLUMN "maxTempF" DECIMAL(6,2);

ALTER TABLE "UserLocation"
ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN;

ALTER TABLE "UserLocation"
ALTER COLUMN "isPrimary" SET DEFAULT FALSE;

UPDATE "UserLocation"
SET "isPrimary" = FALSE
WHERE "isPrimary" IS NULL;

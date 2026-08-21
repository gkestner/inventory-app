ALTER TABLE "Item"
ADD COLUMN "suggestedMinQtyOverride" INTEGER;

ALTER TABLE "Item"
ADD CONSTRAINT "Item_suggestedMinQtyOverride_nonnegative"
CHECK ("suggestedMinQtyOverride" IS NULL OR "suggestedMinQtyOverride" >= 0);

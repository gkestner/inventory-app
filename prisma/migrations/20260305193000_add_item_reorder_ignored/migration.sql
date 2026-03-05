-- Track whether an item should be hidden from the "Needs Ordering" report.
ALTER TABLE "Item"
ADD COLUMN "reorderIgnored" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Item_reorderIgnored_idx" ON "Item"("reorderIgnored");

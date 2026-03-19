ALTER TABLE "WorkOrder"
  ADD COLUMN "workOrderNumber" TEXT,
  ADD COLUMN "generatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WorkOrder_workOrderNumber_key" ON "WorkOrder"("workOrderNumber");
CREATE INDEX "WorkOrder_generatedAt_idx" ON "WorkOrder"("generatedAt");
-- CreateEnum
CREATE TYPE "WorkOrderPingEvent" AS ENUM ('STARTED', 'STOPPED', 'EDITED');

-- CreateTable
CREATE TABLE "WorkOrderPing" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "event" "WorkOrderPingEvent" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderPing_createdAt_idx" ON "WorkOrderPing"("createdAt");

-- CreateIndex
CREATE INDEX "WorkOrderPing_locationId_createdAt_idx" ON "WorkOrderPing"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrderPing_actorUserId_createdAt_idx" ON "WorkOrderPing"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrderPing_workOrderId_createdAt_idx" ON "WorkOrderPing"("workOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkOrderPing"
  ADD CONSTRAINT "WorkOrderPing_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderPing"
  ADD CONSTRAINT "WorkOrderPing_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderPing"
  ADD CONSTRAINT "WorkOrderPing_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

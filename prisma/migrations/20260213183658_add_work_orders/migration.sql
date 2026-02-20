-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "EquipmentArea" AS ENUM ('FRONT_COUNTER', 'DRIVE_THRU', 'KITCHEN', 'WALK_IN', 'FREEZER', 'OFFICE', 'ROOF', 'HVAC', 'OTHER');

-- DropIndex
DROP INDEX "ImportRowError_jobId_createdAt_idx";

-- AlterTable
ALTER TABLE "ImportRowError" ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "locationId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "startingMileage" INTEGER,
    "endingMileage" INTEGER,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderEquipmentArea" (
    "workOrderId" TEXT NOT NULL,
    "area" "EquipmentArea" NOT NULL,

    CONSTRAINT "WorkOrderEquipmentArea_pkey" PRIMARY KEY ("workOrderId","area")
);

-- CreateIndex
CREATE INDEX "WorkOrder_status_createdAt_idx" ON "WorkOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_locationId_createdAt_idx" ON "WorkOrder"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_createdByUserId_createdAt_idx" ON "WorkOrder"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRowError_jobId_rowNumber_idx" ON "ImportRowError"("jobId", "rowNumber");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEquipmentArea" ADD CONSTRAINT "WorkOrderEquipmentArea_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

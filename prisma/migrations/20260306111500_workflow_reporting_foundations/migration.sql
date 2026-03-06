-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORK_ORDER', 'SCHEDULER', 'CYCLE_COUNT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CycleCountSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "PmSchedule" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "locationId" TEXT NOT NULL,
  "defaultUserId" TEXT,
  "intervalDays" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastGeneratedAt" TIMESTAMP(3),
  "nextDueAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PmSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "message" TEXT,
  "metadata" JSONB,
  "workOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
  "title" TEXT NOT NULL,
  "body" TEXT,
  "href" TEXT,
  "readAt" TIMESTAMP(3),
  "emailedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAttachment" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "addedByUserId" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT,
  "byteSize" INTEGER,
  "storageKey" TEXT,
  "url" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountSession" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" "CycleCountSessionStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "CycleCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountItem" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "expectedQty" INTEGER NOT NULL,
  "countedQty" INTEGER NOT NULL,
  "varianceQty" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CycleCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PmSchedule_active_nextDueAt_idx" ON "PmSchedule"("active", "nextDueAt");
CREATE INDEX "PmSchedule_locationId_active_idx" ON "PmSchedule"("locationId", "active");

CREATE INDEX "AuditLog_module_createdAt_idx" ON "AuditLog"("module", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_workOrderId_createdAt_idx" ON "AuditLog"("workOrderId", "createdAt");

CREATE UNIQUE INDEX "SavedView_userId_module_name_key" ON "SavedView"("userId", "module", "name");
CREATE INDEX "SavedView_userId_module_idx" ON "SavedView"("userId", "module");

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

CREATE INDEX "WorkOrderAttachment_workOrderId_createdAt_idx" ON "WorkOrderAttachment"("workOrderId", "createdAt");

CREATE INDEX "CycleCountSession_locationId_status_createdAt_idx" ON "CycleCountSession"("locationId", "status", "createdAt");
CREATE UNIQUE INDEX "CycleCountItem_sessionId_itemId_key" ON "CycleCountItem"("sessionId", "itemId");
CREATE INDEX "CycleCountItem_sessionId_varianceQty_idx" ON "CycleCountItem"("sessionId", "varianceQty");

-- AddForeignKey
ALTER TABLE "PmSchedule" ADD CONSTRAINT "PmSchedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PmSchedule" ADD CONSTRAINT "PmSchedule_defaultUserId_fkey" FOREIGN KEY ("defaultUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PmSchedule" ADD CONSTRAINT "PmSchedule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkOrderAttachment" ADD CONSTRAINT "WorkOrderAttachment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderAttachment" ADD CONSTRAINT "WorkOrderAttachment_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CycleCountSession" ADD CONSTRAINT "CycleCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CycleCountSession" ADD CONSTRAINT "CycleCountSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleCountItem" ADD CONSTRAINT "CycleCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CycleCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CycleCountItem" ADD CONSTRAINT "CycleCountItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

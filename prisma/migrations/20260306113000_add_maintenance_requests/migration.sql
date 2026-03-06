-- Create enum for maintenance request lifecycle.
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'ARCHIVED');

-- Track store-submitted maintenance requests and assignment/resolution.
CREATE TABLE "MaintenanceRequest" (
  "id" TEXT NOT NULL,
  "status" "MaintenanceRequestStatus" NOT NULL DEFAULT 'OPEN',
  "locationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "assignedMaintenanceUserId" TEXT,
  "resolutionNotes" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceRequest_status_createdAt_idx" ON "MaintenanceRequest"("status", "createdAt");
CREATE INDEX "MaintenanceRequest_locationId_status_idx" ON "MaintenanceRequest"("locationId", "status");
CREATE INDEX "MaintenanceRequest_requestedByUserId_createdAt_idx" ON "MaintenanceRequest"("requestedByUserId", "createdAt");
CREATE INDEX "MaintenanceRequest_assignedMaintenanceUserId_status_idx" ON "MaintenanceRequest"("assignedMaintenanceUserId", "status");
CREATE INDEX "MaintenanceRequest_resolvedByUserId_resolvedAt_idx" ON "MaintenanceRequest"("resolvedByUserId", "resolvedAt");

ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_assignedMaintenanceUserId_fkey"
  FOREIGN KEY ("assignedMaintenanceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

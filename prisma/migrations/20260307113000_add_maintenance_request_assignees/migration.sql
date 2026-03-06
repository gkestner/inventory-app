CREATE TABLE IF NOT EXISTS "MaintenanceRequestAssignee" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MaintenanceRequestAssignee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaintenanceRequestAssignee_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaintenanceRequestAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceRequestAssignee_requestId_userId_key"
  ON "MaintenanceRequestAssignee"("requestId", "userId");

CREATE INDEX IF NOT EXISTS "MaintenanceRequestAssignee_requestId_idx"
  ON "MaintenanceRequestAssignee"("requestId");

CREATE INDEX IF NOT EXISTS "MaintenanceRequestAssignee_userId_idx"
  ON "MaintenanceRequestAssignee"("userId");

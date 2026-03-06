ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEMPERATURE_ALERT';

CREATE TYPE "TemperatureAlertState" AS ENUM ('NORMAL', 'HIGH', 'LOW', 'UNKNOWN');

CREATE TABLE "MocreoHub" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalHubId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "locationId" TEXT,
  "assignedMaintenanceUserId" TEXT,
  "minTempF" DECIMAL(6,2),
  "maxTempF" DECIMAL(6,2),
  "lastReadingAt" TIMESTAMP(3),
  "lastTempF" DECIMAL(6,2),
  "lastAlertState" "TemperatureAlertState",
  "lastAlertAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MocreoHub_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MocreoHubRecipient" (
  "hubId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MocreoHubRecipient_pkey" PRIMARY KEY ("hubId","userId")
);

CREATE TABLE "MocreoDevice" (
  "id" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalDeviceId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "lastReadingAt" TIMESTAMP(3),
  "lastTempF" DECIMAL(6,2),
  "lastBatteryPct" INTEGER,
  "lastSignalPct" INTEGER,
  "lastAlertState" "TemperatureAlertState",
  "lastRawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MocreoDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MocreoTemperatureReading" (
  "id" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "deviceId" TEXT,
  "externalReadingId" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "tempF" DECIMAL(6,2),
  "batteryPct" INTEGER,
  "signalPct" INTEGER,
  "alertState" "TemperatureAlertState" NOT NULL DEFAULT 'UNKNOWN',
  "rawPayload" JSONB,
  "notificationSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MocreoTemperatureReading_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MocreoHub_externalHubId_key" ON "MocreoHub"("externalHubId");
CREATE INDEX "MocreoHub_active_name_idx" ON "MocreoHub"("active", "name");
CREATE INDEX "MocreoHub_locationId_active_idx" ON "MocreoHub"("locationId", "active");
CREATE INDEX "MocreoHub_assignedMaintenanceUserId_active_idx" ON "MocreoHub"("assignedMaintenanceUserId", "active");

CREATE INDEX "MocreoHubRecipient_userId_idx" ON "MocreoHubRecipient"("userId");

CREATE UNIQUE INDEX "MocreoDevice_hubId_externalDeviceId_key" ON "MocreoDevice"("hubId", "externalDeviceId");
CREATE INDEX "MocreoDevice_hubId_name_idx" ON "MocreoDevice"("hubId", "name");

CREATE INDEX "MocreoTemperatureReading_hubId_recordedAt_idx" ON "MocreoTemperatureReading"("hubId", "recordedAt");
CREATE INDEX "MocreoTemperatureReading_deviceId_recordedAt_idx" ON "MocreoTemperatureReading"("deviceId", "recordedAt");
CREATE INDEX "MocreoTemperatureReading_alertState_recordedAt_idx" ON "MocreoTemperatureReading"("alertState", "recordedAt");
CREATE INDEX "MocreoTemperatureReading_externalReadingId_idx" ON "MocreoTemperatureReading"("externalReadingId");

ALTER TABLE "MocreoHub"
  ADD CONSTRAINT "MocreoHub_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MocreoHub"
  ADD CONSTRAINT "MocreoHub_assignedMaintenanceUserId_fkey"
  FOREIGN KEY ("assignedMaintenanceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MocreoHubRecipient"
  ADD CONSTRAINT "MocreoHubRecipient_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "MocreoHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MocreoHubRecipient"
  ADD CONSTRAINT "MocreoHubRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MocreoDevice"
  ADD CONSTRAINT "MocreoDevice_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "MocreoHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MocreoTemperatureReading"
  ADD CONSTRAINT "MocreoTemperatureReading_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "MocreoHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MocreoTemperatureReading"
  ADD CONSTRAINT "MocreoTemperatureReading_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "MocreoDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

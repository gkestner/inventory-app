-- Company vehicle maintenance, reminders, and service logs
CREATE TYPE "VehicleMileageSource" AS ENUM ('MANUAL', 'WORK_ORDERS_BY_ASSIGNED_USER');
CREATE TYPE "VehicleReminderType" AS ENUM ('TIME_BASED', 'MILEAGE_BASED');

CREATE TABLE "CompanyVehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitNumber" TEXT,
    "licensePlate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mileageSource" "VehicleMileageSource" NOT NULL DEFAULT 'MANUAL',
    "currentMileage" INTEGER,
    "assignedUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleMaintenanceReminder" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reminderType" "VehicleReminderType" NOT NULL,
    "intervalDays" INTEGER,
    "intervalMiles" INTEGER,
    "lastCompletedAt" TIMESTAMP(3),
    "lastCompletedMileage" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleMaintenanceReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyVehicleServiceLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "reminderId" TEXT,
    "serviceAt" TIMESTAMP(3) NOT NULL,
    "odometer" INTEGER,
    "serviceType" TEXT,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "cost" DECIMAL(10,2),
    "performedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyVehicleServiceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyVehicle_active_name_idx" ON "CompanyVehicle"("active", "name");
CREATE INDEX "CompanyVehicle_assignedUserId_active_idx" ON "CompanyVehicle"("assignedUserId", "active");

CREATE INDEX "VehicleMaintenanceReminder_vehicleId_active_idx" ON "VehicleMaintenanceReminder"("vehicleId", "active");
CREATE INDEX "VehicleMaintenanceReminder_reminderType_active_idx" ON "VehicleMaintenanceReminder"("reminderType", "active");

CREATE INDEX "CompanyVehicleServiceLog_vehicleId_serviceAt_idx" ON "CompanyVehicleServiceLog"("vehicleId", "serviceAt");
CREATE INDEX "CompanyVehicleServiceLog_reminderId_idx" ON "CompanyVehicleServiceLog"("reminderId");
CREATE INDEX "CompanyVehicleServiceLog_performedByUserId_serviceAt_idx" ON "CompanyVehicleServiceLog"("performedByUserId", "serviceAt");
CREATE INDEX "CompanyVehicleServiceLog_createdByUserId_serviceAt_idx" ON "CompanyVehicleServiceLog"("createdByUserId", "serviceAt");

ALTER TABLE "CompanyVehicle"
ADD CONSTRAINT "CompanyVehicle_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleMaintenanceReminder"
ADD CONSTRAINT "VehicleMaintenanceReminder_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "CompanyVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleMaintenanceReminder"
ADD CONSTRAINT "VehicleMaintenanceReminder_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VehicleMaintenanceReminder"
ADD CONSTRAINT "VehicleMaintenanceReminder_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyVehicleServiceLog"
ADD CONSTRAINT "CompanyVehicleServiceLog_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "CompanyVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyVehicleServiceLog"
ADD CONSTRAINT "CompanyVehicleServiceLog_reminderId_fkey"
FOREIGN KEY ("reminderId") REFERENCES "VehicleMaintenanceReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyVehicleServiceLog"
ADD CONSTRAINT "CompanyVehicleServiceLog_performedByUserId_fkey"
FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyVehicleServiceLog"
ADD CONSTRAINT "CompanyVehicleServiceLog_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

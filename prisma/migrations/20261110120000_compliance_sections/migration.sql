BEGIN;
-- Additive section metadata; annual service records remain authoritative and untouched.
CREATE TYPE "ComplianceSectionKind" AS ENUM ('GREASE_TRAP', 'BACKFLOW', 'BOILER');
ALTER TABLE "NotificationReminderList"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "complianceKind" "ComplianceSectionKind",
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 1000,
  ALTER COLUMN "createdByUserId" DROP NOT NULL;
CREATE UNIQUE INDEX "NotificationReminderList_complianceKind_key" ON "NotificationReminderList"("complianceKind");
ALTER TABLE "NotificationReminderList"
  ADD CONSTRAINT "NotificationReminderList_sortOrder_check" CHECK ("sortOrder" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "NotificationReminderList_description_check" CHECK ("description" IS NULL OR char_length("description") <= 2000),
  ADD CONSTRAINT "NotificationReminderList_creator_check" CHECK ("createdByUserId" IS NOT NULL OR "complianceKind" IS NOT NULL);
ALTER TABLE "NotificationReminderLocation" ADD COLUMN "useLocationRecipients" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "NotificationReminderLocationRecipient" (
  "reminderLocationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "NotificationReminderLocationRecipient_pkey" PRIMARY KEY ("reminderLocationId", "userId"),
  CONSTRAINT "NotificationReminderLocationRecipient_reminderLocationId_fkey" FOREIGN KEY ("reminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationReminderLocationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "NotificationReminderLocationRecipient_userId_idx" ON "NotificationReminderLocationRecipient"("userId");
INSERT INTO "NotificationReminderList" ("id", "name", "description", "complianceKind", "sortOrder", "defaultIntervalMonths", "active", "createdAt", "updatedAt") VALUES
  ('compliance-grease-trap', 'Grease Trap', 'Grease trap pumping, service companies, tank size and cost.', 'GREASE_TRAP', 10, 11, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('compliance-backflow', 'Backflow', 'Backflow testing, service companies and amount.', 'BACKFLOW', 20, 11, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('compliance-boiler', 'Boiler', 'Boiler inspections, service companies, cost and secondary inspection date.', 'BOILER', 30, 11, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "NotificationReminderLocation" ("id", "listId", "locationId", "hidden", "useLocationRecipients", "createdAt", "updatedAt")
SELECT 'compliance-row-' || l."id" || '-' || s."complianceKind"::TEXT, s."id", l."id", false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Location" l CROSS JOIN "NotificationReminderList" s
WHERE s."complianceKind" IS NOT NULL;

-- Existing company labels and annual facts remain intact; edited records gain
-- stable relational company identities without guessing historical matches.
ALTER TABLE "PreventativeMaintenanceEntry"
  ADD COLUMN "greaseTrapCompanyId" TEXT,
  ADD COLUMN "backflowCompanyId" TEXT,
  ADD COLUMN "boilerInspectionCompanyId" TEXT;
ALTER TABLE "PreventativeMaintenanceEntry"
  ADD CONSTRAINT "PreventativeMaintenanceEntry_greaseTrapCompanyId_fkey" FOREIGN KEY ("greaseTrapCompanyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PreventativeMaintenanceEntry_backflowCompanyId_fkey" FOREIGN KEY ("backflowCompanyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PreventativeMaintenanceEntry_boilerInspectionCompanyId_fkey" FOREIGN KEY ("boilerInspectionCompanyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

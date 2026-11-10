BEGIN;
CREATE TABLE "ReminderCompany" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderCompany_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "ReminderCompany_normalizedName_check" CHECK (length(trim("normalizedName")) > 0)
);
CREATE UNIQUE INDEX "ReminderCompany_normalizedName_key" ON "ReminderCompany"("normalizedName");
CREATE TABLE "NotificationReminderList" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "defaultIntervalMonths" INTEGER NOT NULL DEFAULT 11,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationReminderList_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "NotificationReminderList_interval_check" CHECK ("defaultIntervalMonths" BETWEEN 1 AND 120),
  CONSTRAINT "NotificationReminderList_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "NotificationReminderList_active_idx" ON "NotificationReminderList"("active");
CREATE TABLE "NotificationReminderLocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "listId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "companyId" TEXT,
  "referenceOn" DATE,
  "nextDueOn" DATE,
  "intervalMonths" INTEGER,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationReminderLocation_interval_check" CHECK ("intervalMonths" IS NULL OR "intervalMonths" BETWEEN 1 AND 120),
  CONSTRAINT "NotificationReminderLocation_dates_check" CHECK (("referenceOn" IS NULL) = ("nextDueOn" IS NULL)),
  CONSTRAINT "NotificationReminderLocation_listId_fkey" FOREIGN KEY ("listId") REFERENCES "NotificationReminderList"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationReminderLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationReminderLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationReminderLocation_listId_locationId_key" ON "NotificationReminderLocation"("listId", "locationId");
CREATE INDEX "NotificationReminderLocation_hidden_nextDueOn_idx" ON "NotificationReminderLocation"("hidden", "nextDueOn");
CREATE TABLE "NotificationReminderRecipient" (
  "listId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "NotificationReminderRecipient_pkey" PRIMARY KEY ("listId", "userId"),
  CONSTRAINT "NotificationReminderRecipient_listId_fkey" FOREIGN KEY ("listId") REFERENCES "NotificationReminderList"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationReminderRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "NotificationReminderOccurrence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reminderLocationId" TEXT NOT NULL,
  "dueOn" DATE NOT NULL,
  "referenceOn" DATE NOT NULL,
  "intervalMonths" INTEGER NOT NULL,
  "companyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationReminderOccurrence_interval_check" CHECK ("intervalMonths" BETWEEN 1 AND 120),
  CONSTRAINT "NotificationReminderOccurrence_reminderLocationId_fkey" FOREIGN KEY ("reminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationReminderOccurrence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationReminderOccurrence_reminderLocationId_dueOn_key" ON "NotificationReminderOccurrence"("reminderLocationId", "dueOn");
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT, ADD COLUMN "reminderOccurrenceId" TEXT;
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE UNIQUE INDEX "Notification_userId_reminderOccurrenceId_key" ON "Notification"("userId", "reminderOccurrenceId");
CREATE INDEX "Notification_reminderOccurrenceId_idx" ON "Notification"("reminderOccurrenceId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reminderOccurrenceId_fkey" FOREIGN KEY ("reminderOccurrenceId") REFERENCES "NotificationReminderOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

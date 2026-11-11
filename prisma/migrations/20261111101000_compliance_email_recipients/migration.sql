BEGIN;

CREATE TABLE "ReminderEmailContact" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderEmailContact_email_check" CHECK (
    "email" = lower(btrim("email")) AND char_length("email") BETWEEN 3 AND 320
    AND "email" ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
  )
);
CREATE UNIQUE INDEX "ReminderEmailContact_email_key" ON "ReminderEmailContact"("email");

CREATE TABLE "NotificationReminderListEmailRecipient" (
  "listId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  CONSTRAINT "ReminderListEmailRecipient_pkey" PRIMARY KEY ("listId", "contactId"),
  CONSTRAINT "ReminderListEmailRecipient_list_fkey" FOREIGN KEY ("listId") REFERENCES "NotificationReminderList"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReminderListEmailRecipient_contact_fkey" FOREIGN KEY ("contactId") REFERENCES "ReminderEmailContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReminderListEmailRecipient_contact_idx" ON "NotificationReminderListEmailRecipient"("contactId");

CREATE TABLE "NotificationReminderLocationEmailRecipient" (
  "reminderLocationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  CONSTRAINT "ReminderLocationEmailRecipient_pkey" PRIMARY KEY ("reminderLocationId", "contactId"),
  CONSTRAINT "ReminderLocationEmailRecipient_location_fkey" FOREIGN KEY ("reminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReminderLocationEmailRecipient_contact_fkey" FOREIGN KEY ("contactId") REFERENCES "ReminderEmailContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReminderLocationEmailRecipient_contact_idx" ON "NotificationReminderLocationEmailRecipient"("contactId");

CREATE UNIQUE INDEX "NotificationReminderOccurrence_id_reminderLocationId_key"
  ON "NotificationReminderOccurrence"("id", "reminderLocationId");

CREATE TABLE "ReminderEmailEvent" (
  "id" TEXT PRIMARY KEY,
  "contactId" TEXT NOT NULL,
  "reminderLocationId" TEXT NOT NULL,
  "reminderOccurrenceId" TEXT,
  "complianceServiceEntryId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "referenceOn" DATE NOT NULL,
  "intervalMonths" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderEmailEvent_source_check" CHECK (num_nonnulls("reminderOccurrenceId", "complianceServiceEntryId") = 1),
  CONSTRAINT "ReminderEmailEvent_interval_check" CHECK ("intervalMonths" BETWEEN 1 AND 120),
  CONSTRAINT "ReminderEmailEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ReminderEmailContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReminderEmailEvent_reminderLocationId_fkey" FOREIGN KEY ("reminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReminderEmailEvent_occurrence_location_fkey" FOREIGN KEY ("reminderOccurrenceId", "reminderLocationId") REFERENCES "NotificationReminderOccurrence"("id", "reminderLocationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReminderEmailEvent_serviceEntry_location_fkey" FOREIGN KEY ("complianceServiceEntryId", "reminderLocationId") REFERENCES "ComplianceServiceEntry"("id", "reminderLocationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReminderEmailEvent_contactId_dedupeKey_key" ON "ReminderEmailEvent"("contactId", "dedupeKey");
CREATE INDEX "ReminderEmailEvent_reminderLocationId_idx" ON "ReminderEmailEvent"("reminderLocationId");
CREATE INDEX "ReminderEmailEvent_occurrence_idx" ON "ReminderEmailEvent"("reminderOccurrenceId");
CREATE INDEX "ReminderEmailEvent_serviceEntry_idx" ON "ReminderEmailEvent"("complianceServiceEntryId");

ALTER TABLE "NotificationEmailDelivery"
  ALTER COLUMN "notificationId" DROP NOT NULL,
  ALTER COLUMN "recipientUserId" DROP NOT NULL,
  ADD COLUMN "reminderEmailEventId" TEXT,
  ADD CONSTRAINT "NotificationEmailDelivery_reminderEmailEventId_fkey" FOREIGN KEY ("reminderEmailEventId") REFERENCES "ReminderEmailEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationEmailDelivery_source_recipient_check" CHECK (
    ("notificationId" IS NOT NULL AND "reminderEmailEventId" IS NULL AND "recipientUserId" IS NOT NULL)
    OR
    ("notificationId" IS NULL AND "reminderEmailEventId" IS NOT NULL AND
      (("kind" = 'PRIMARY' AND "recipientUserId" IS NULL) OR ("kind" = 'OVERSIGHT' AND "recipientUserId" IS NOT NULL)))
  );
CREATE UNIQUE INDEX "NotificationEmailDelivery_event_recipientUser_key" ON "NotificationEmailDelivery"("reminderEmailEventId", "recipientUserId");
CREATE UNIQUE INDEX "NotificationEmailDelivery_event_primary_key" ON "NotificationEmailDelivery"("reminderEmailEventId")
  WHERE "reminderEmailEventId" IS NOT NULL AND "kind" = 'PRIMARY';

COMMIT;

BEGIN;
CREATE TYPE "NotificationEmailKind" AS ENUM ('PRIMARY', 'OVERSIGHT');
ALTER TABLE "NotificationEmailDelivery"
  ADD COLUMN "id" TEXT,
  ADD COLUMN "recipientUserId" TEXT,
  ADD COLUMN "kind" "NotificationEmailKind" NOT NULL DEFAULT 'PRIMARY';
-- Preserve every existing primary job, status, attempt, lease, provider ID and
-- timestamp. Its old notificationId remains its stable delivery job ID.
UPDATE "NotificationEmailDelivery" AS delivery
SET "id" = delivery."notificationId", "recipientUserId" = notification."userId"
FROM "Notification" AS notification WHERE notification."id" = delivery."notificationId";
ALTER TABLE "NotificationEmailDelivery"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "recipientUserId" SET NOT NULL,
  DROP CONSTRAINT "NotificationEmailDelivery_pkey",
  ADD CONSTRAINT "NotificationEmailDelivery_pkey" PRIMARY KEY ("id"),
  ADD CONSTRAINT "NotificationEmailDelivery_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "NotificationEmailDelivery_notificationId_recipientUserId_key" ON "NotificationEmailDelivery"("notificationId", "recipientUserId");
CREATE INDEX "NotificationEmailDelivery_recipientUserId_updatedAt_idx" ON "NotificationEmailDelivery"("recipientUserId", "updatedAt");
CREATE TABLE "NotificationOversightSubscriber" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationOversightSubscriber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationOversightSubscriber_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "NotificationOversightSubscriber_enabled_idx" ON "NotificationOversightSubscriber"("enabled");
-- Resolve the explicitly requested owner once, then retain only stable FK
-- identity. Enrollment is conditional on current active, full administrator
-- authority; generic module-management permissions do not grant oversight.
INSERT INTO "NotificationOversightSubscriber" ("userId", "enabled", "createdByUserId", "createdAt", "updatedAt")
SELECT owner."id", true, owner."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" AS owner
WHERE lower(trim(owner."email")) = 'gkestner@pizzaplusinc.com'
  AND owner."active" = true
  AND (SELECT count(*) FROM "User" AS candidate WHERE lower(trim(candidate."email")) = 'gkestner@pizzaplusinc.com' AND candidate."active" = true) = 1
  AND (owner."role" = 'ADMIN' OR EXISTS (
    SELECT 1 FROM "UserRole" AS assigned
    JOIN "AppRole" AS role ON role."id" = assigned."roleId"
    WHERE assigned."userId" = owner."id" AND role."isSystem" = true AND upper(trim(role."name")) = 'ADMIN'
  ))
ON CONFLICT ("userId") DO NOTHING;
-- No historical notifications receive oversight jobs. Only future event
-- creation populates their recipient jobs through the shared outbox pipeline.
ALTER TABLE "Notification" ADD COLUMN "complianceReminderLocationId" TEXT;
CREATE INDEX "Notification_complianceReminderLocationId_idx" ON "Notification"("complianceReminderLocationId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_complianceReminderLocationId_fkey" FOREIGN KEY ("complianceReminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

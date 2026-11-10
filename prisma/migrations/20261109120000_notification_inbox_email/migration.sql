-- Additive migration: preserve every existing notification and its read history.
BEGIN;
ALTER TABLE "User" ADD COLUMN "notificationEmailEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Notification" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TYPE "NotificationEmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TABLE "NotificationEmailDelivery" (
  "notificationId" TEXT NOT NULL,
  "status" "NotificationEmailStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "lastError" TEXT,
  "messageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationEmailDelivery_pkey" PRIMARY KEY ("notificationId"),
  CONSTRAINT "NotificationEmailDelivery_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "NotificationEmailDelivery_lease_check" CHECK (
    ("status" = 'SENDING' AND "claimToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'SENDING' AND "claimToken" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  CONSTRAINT "NotificationEmailDelivery_sent_check" CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL)),
  CONSTRAINT "NotificationEmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Notification_userId_deletedAt_archivedAt_createdAt_idx" ON "Notification"("userId", "deletedAt", "archivedAt", "createdAt");
CREATE INDEX "NotificationEmailDelivery_status_nextAttemptAt_idx" ON "NotificationEmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationEmailDelivery_status_leaseExpiresAt_idx" ON "NotificationEmailDelivery"("status", "leaseExpiresAt");
-- Intentionally do not backfill historical emails: enabling this feature must
-- never send a backlog of old business notifications to users.
COMMIT;

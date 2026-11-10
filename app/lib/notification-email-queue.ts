import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isNotificationOversightAdministrator } from "@/app/lib/notification-oversight-rules";

export const MAX_NOTIFICATION_EMAIL_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;

const EMAIL_JOB_INCLUDE = {
  recipient: { select: {
    id: true, name: true, email: true, active: true, role: true, notificationEmailEnabled: true,
    roles: { select: { role: { select: { name: true, isSystem: true } } } },
    notificationOversightSubscription: { select: { enabled: true } },
  } },
  notification: { include: {
    user: { select: { id: true, name: true, email: true } },
    complianceReminderLocation: { select: { hidden: true, list: { select: { active: true } }, location: { select: { active: true } } } },
    reminderOccurrence: { include: { reminderLocation: { select: {
      hidden: true, referenceOn: true, intervalMonths: true,
      list: { select: { active: true, defaultIntervalMonths: true } },
      location: { select: { active: true } },
    } } } },
  } },
} as const satisfies Prisma.NotificationEmailDeliveryInclude;
type EmailJob = Prisma.NotificationEmailDeliveryGetPayload<{ include: typeof EMAIL_JOB_INCLUDE }>;
type QueueDb = Pick<PrismaClient, "notificationEmailDelivery" | "$transaction">;

export function notificationEmailRetryAt(attempts: number, now: Date) {
  return new Date(now.getTime() + Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1)));
}

export function notificationEmailDueWhere(now: Date): Prisma.NotificationEmailDeliveryWhereInput {
  return {
    attempts: { lt: MAX_NOTIFICATION_EMAIL_ATTEMPTS },
    OR: [
      { status: "PENDING", nextAttemptAt: { lte: now } },
      { status: "SENDING", leaseExpiresAt: { lte: now } },
    ],
  };
}

export async function runNotificationEmailQueue(args: {
  db: QueueDb;
  send: (job: EmailJob) => Promise<{ messageId: string }>;
  notificationIds?: string[];
  limit?: number;
  timeBudgetMs?: number;
}) {
  const { db } = args;
  const started = Date.now();
  const result = { sent: 0, failed: 0, skipped: 0, claimed: 0 };
  const idFilter = args.notificationIds ? { notificationId: { in: args.notificationIds } } : {};
  // A crashed last attempt is terminal rather than stuck or incremented past the cap.
  await db.notificationEmailDelivery.updateMany({
    where: { ...idFilter, status: "SENDING", attempts: { gte: MAX_NOTIFICATION_EMAIL_ATTEMPTS }, leaseExpiresAt: { lte: new Date() } },
    data: { status: "FAILED", claimToken: null, leaseExpiresAt: null, lastError: "Delivery could not be confirmed before its final lease expired." },
  });
  const rows = await db.notificationEmailDelivery.findMany({
    where: { ...idFilter, ...notificationEmailDueWhere(new Date()) },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(args.limit ?? 20, 100)),
    select: { id: true },
  });
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length && Date.now() - started < (args.timeBudgetMs ?? 20_000)) {
      const row = rows[cursor++];
      const claimToken = randomUUID();
      const claim = await db.notificationEmailDelivery.updateMany({
        where: { id: row.id, ...notificationEmailDueWhere(new Date()) },
        data: { status: "SENDING", claimToken, leaseExpiresAt: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
      });
      if (!claim.count) continue; // Another worker owns it (or demo mode suppressed the write).
      result.claimed++;
      const owned = { id: row.id, status: "SENDING" as const, claimToken };
      const job = await db.notificationEmailDelivery.findFirst({
        where: owned,
        include: EMAIL_JOB_INCLUDE,
      });
      if (!job) continue;
      const reminder = job.notification.reminderOccurrence?.reminderLocation;
      const occurrence = job.notification.reminderOccurrence;
      const reminderPaused = reminder && occurrence && (reminder.hidden || !reminder.referenceOn || !reminder.list.active || !reminder.location.active ||
        reminder.referenceOn.getTime() !== occurrence.referenceOn.getTime() ||
        (reminder.intervalMonths ?? reminder.list.defaultIntervalMonths) !== occurrence.intervalMonths);
      const compliance = job.notification.complianceReminderLocation;
      const compliancePaused = compliance && (compliance.hidden || !compliance.list.active || !compliance.location.active);
      const primarySuppressed = job.kind === "PRIMARY" && (job.recipientUserId !== job.notification.userId || job.notification.deletedAt || reminderPaused || compliancePaused);
      // Oversight describes an event already delivered in-app. Later changes by
      // its original recipient or schedule do not suppress the administrator's
      // independent copy; the observer's current enrollment/authority still do.
      const oversightSuppressed = job.kind === "OVERSIGHT" && (job.recipientUserId === job.notification.userId ||
        !job.recipient.notificationOversightSubscription?.enabled || !isNotificationOversightAdministrator(job.recipient));
      if (!job.recipient.active || !job.recipient.notificationEmailEnabled || primarySuppressed || oversightSuppressed) {
        await db.notificationEmailDelivery.updateMany({
          where: owned,
          data: { status: "SKIPPED", claimToken: null, leaseExpiresAt: null, lastError: null },
        });
        result.skipped++;
        continue;
      }
      try {
        const sent = await args.send(job);
        const sentAt = new Date();
        await db.$transaction(async (tx) => {
          const updated = await tx.notificationEmailDelivery.updateMany({
            where: owned,
            data: { status: "SENT", sentAt, messageId: sent.messageId, claimToken: null, leaseExpiresAt: null, lastError: null },
          });
          if (updated.count && job.kind === "PRIMARY") await tx.notification.update({ where: { id: job.notificationId }, data: { emailedAt: sentAt } });
        });
        result.sent++;
      } catch (error) {
        // Avoid storing SMTP responses, addresses, or credentials in user-visible errors.
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DELIVERY_ERROR";
        const safeCode = /^[A-Z0-9_]{1,32}$/.test(code) ? code : "DELIVERY_ERROR";
        const exhausted = job.attempts >= MAX_NOTIFICATION_EMAIL_ATTEMPTS;
        await db.notificationEmailDelivery.updateMany({
          where: owned,
          data: {
            status: exhausted ? "FAILED" : "PENDING",
            claimToken: null,
            leaseExpiresAt: null,
            lastError: `Email delivery failed (${safeCode}).${exhausted ? " Retry limit reached." : " Will retry automatically."}`,
            nextAttemptAt: notificationEmailRetryAt(job.attempts, new Date()),
          },
        });
        result.failed++;
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return result;
}

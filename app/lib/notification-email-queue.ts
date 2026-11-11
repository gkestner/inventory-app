import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { latestComplianceRecords } from "@/app/lib/compliance-history-fields";
import { notificationEmailRecipient } from "@/app/lib/notification-email-content";
import { isNotificationOversightAdministrator } from "@/app/lib/notification-oversight-rules";
import { loadNotificationOversightRecipients } from "@/app/lib/notification-oversight";
import { reminderSchedule } from "@/app/lib/reminder-dates";
import { reminderEmailAccountExists } from "@/app/lib/reminder-email-contacts";
import { reminderRecipientIds } from "@/app/lib/reminder-recipients";

export const MAX_NOTIFICATION_EMAIL_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;

const reminderState = {
  hidden: true,
  list: { select: { active: true } },
  location: { select: { active: true } },
} as const;
const reminderTiming = {
  ...reminderState,
  referenceOn: true,
  intervalMonths: true,
  list: { select: { active: true, defaultIntervalMonths: true } },
} as const;
const EMAIL_JOB_INCLUDE = {
  recipient: { select: {
    id: true, name: true, email: true, active: true, role: true, notificationEmailEnabled: true,
    roles: { select: { role: { select: { name: true, isSystem: true } } } },
    notificationOversightSubscription: { select: { enabled: true } },
  } },
  notification: { include: {
    user: { select: { id: true, name: true, email: true } },
    complianceReminderLocation: { select: reminderState },
    reminderOccurrence: { include: { reminderLocation: { select: reminderTiming } } },
  } },
  reminderEmailEvent: { include: {
    contact: { select: { email: true } },
    reminderOccurrence: { select: { referenceOn: true, intervalMonths: true } },
    emailDeliveries: { where: { kind: "PRIMARY", status: "SENT" }, select: { id: true }, take: 1 },
    reminderLocation: { select: {
      ...reminderTiming,
      useLocationRecipients: true,
      emailRecipients: { select: { contactId: true } },
      list: { select: {
        ...reminderTiming.list.select,
        complianceKind: true,
        includeCategoryRecipients: true,
        emailRecipients: { select: { contactId: true } },
      } },
    } },
  } },
} as const satisfies Prisma.NotificationEmailDeliveryInclude;
type EmailJob = Prisma.NotificationEmailDeliveryGetPayload<{ include: typeof EMAIL_JOB_INCLUDE }>;
type QueueDb = Pick<PrismaClient, "notificationEmailDelivery" | "complianceServiceEntry" | "$queryRaw" | "$transaction">;
type ReminderState = Prisma.NotificationReminderLocationGetPayload<{ select: typeof reminderState }>;
type ReminderTiming = Prisma.NotificationReminderLocationGetPayload<{ select: typeof reminderTiming }>;
type ReminderSnapshot = { referenceOn: Date; intervalMonths: number };

function paused(reminder: ReminderState) {
  return reminder.hidden || !reminder.list.active || !reminder.location.active;
}

function sameTiming(snapshot: ReminderSnapshot, date: Date | null, months: number) {
  return date?.getTime() === snapshot.referenceOn.getTime() && months === snapshot.intervalMonths;
}

function currentCustomSchedule(reminder: ReminderTiming, snapshot: ReminderSnapshot) {
  return !paused(reminder) && sameTiming(snapshot, reminder.referenceOn, reminder.intervalMonths ?? reminder.list.defaultIntervalMonths);
}

async function canSendExternalReminder(db: QueueDb, event: NonNullable<EmailJob["reminderEmailEvent"]>) {
  const reminder = event.reminderLocation;
  if (paused(reminder)) return false;

  const contacts = reminderRecipientIds({
    sectionIds: reminder.list.emailRecipients.map(({ contactId }) => contactId),
    locationIds: reminder.emailRecipients.map(({ contactId }) => contactId),
    useLocationRecipients: reminder.useLocationRecipients,
    includeCategoryRecipients: reminder.list.includeCategoryRecipients,
  });
  if (!contacts.includes(event.contactId)) return false;

  if (event.reminderOccurrence) {
    if (reminder.list.complianceKind || !currentCustomSchedule(reminder, event) ||
      !sameTiming(event, event.reminderOccurrence.referenceOn, event.reminderOccurrence.intervalMonths)) return false;
  } else {
    if (!reminder.list.complianceKind || !event.complianceServiceEntryId) return false;
    const history = await db.complianceServiceEntry.findMany({
      where: { reminderLocationId: event.reminderLocationId, supersededBy: null },
      select: { id: true, reminderLocationId: true, serviceDate: true, intervalText: true, recordedAt: true },
    });
    const latest = latestComplianceRecords(history)[0];
    if (latest?.id !== event.complianceServiceEntryId) return false;
    const schedule = reminderSchedule(latest.serviceDate, latest.intervalText, reminder.list.defaultIntervalMonths);
    if (!schedule || !sameTiming(event, schedule.referenceOn, schedule.intervalMonths)) return false;
  }

  let address: string;
  try {
    address = notificationEmailRecipient(event.contact.email);
  } catch {
    return false;
  }
  return !await reminderEmailAccountExists(db, [address.toLowerCase()]);
}

async function canSendJob(db: QueueDb, job: EmailJob) {
  const { kind, notification, recipient, reminderEmailEvent: event } = job;
  if (kind === "PRIMARY" && event) return canSendExternalReminder(db, event);
  if (!recipient?.active || !recipient.notificationEmailEnabled) return false;

  if (kind === "OVERSIGHT") {
    if (!recipient.notificationOversightSubscription?.enabled || !isNotificationOversightAdministrator(recipient)) return false;
    // An accepted email-only delivery remains a historical event after a pause.
    if (event) return event.emailDeliveries.length > 0 && recipient.email.trim().toLowerCase() !== event.contact.email;
    return Boolean(notification && job.recipientUserId !== notification.userId);
  }

  if (!notification || job.recipientUserId !== notification.userId || notification.deletedAt) return false;
  const { reminderOccurrence, complianceReminderLocation } = notification;
  return !(reminderOccurrence && !currentCustomSchedule(reminderOccurrence.reminderLocation, reminderOccurrence)) &&
    !(complianceReminderLocation && paused(complianceReminderLocation));
}

async function queueAcceptedExternalOversight(tx: Prisma.TransactionClient, event: NonNullable<EmailJob["reminderEmailEvent"]>) {
  const observers = await loadNotificationOversightRecipients(tx);
  const data = observers.filter((observer) => observer.email.trim().toLowerCase() !== event.contact.email).map((observer) => ({
    reminderEmailEventId: event.id,
    recipientUserId: observer.id,
    kind: "OVERSIGHT" as const,
    status: observer.notificationEmailEnabled ? "PENDING" as const : "SKIPPED" as const,
  }));
  if (data.length) await tx.notificationEmailDelivery.createMany({ data, skipDuplicates: true });
}

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
      try {
        if (!await canSendJob(db, job)) {
          await db.notificationEmailDelivery.updateMany({
            where: owned,
            data: { status: "SKIPPED", claimToken: null, leaseExpiresAt: null, lastError: null },
          });
          result.skipped++;
          continue;
        }
        const sent = await args.send(job);
        const sentAt = new Date();
        await db.$transaction(async (tx) => {
          const updated = await tx.notificationEmailDelivery.updateMany({
            where: owned,
            data: { status: "SENT", sentAt, messageId: sent.messageId, claimToken: null, leaseExpiresAt: null, lastError: null },
          });
          if (!updated.count || job.kind !== "PRIMARY") return;
          if (job.notificationId) await tx.notification.update({ where: { id: job.notificationId }, data: { emailedAt: sentAt } });
          else if (job.reminderEmailEvent) await queueAcceptedExternalOversight(tx, job.reminderEmailEvent);
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

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma, isDemoModeActiveForRequest } from "@/app/lib/prisma";
import { createNotificationForUsers } from "@/app/lib/workflow-foundations";
import { scheduleNotificationEmails } from "@/app/lib/notification-email";
import { formatReminderDate, nextReminderAfter, parseReminderDate, reminderToday } from "@/app/lib/reminder-dates";
import { queueReminderEmailEvents, reminderDeliveryRecipients, reminderRecipientSelection } from "@/app/lib/reminder-email-events";

class NoReminderRecipients extends Error {}

export async function lockNotificationReminderList(tx: Prisma.TransactionClient, listId: string) {
  // Consistent list-before-row lock ordering serializes scans with edits, pauses,
  // recipient changes and other scans without relying on a server-local mutex.
  await tx.$queryRaw`SELECT "id" FROM "NotificationReminderList" WHERE "id" = ${listId} FOR UPDATE`;
}

export async function pauseQueuedReminderEmails(tx: Prisma.TransactionClient, filter: { listId: string; reminderLocationId?: string }) {
  const reminderLocation = { listId: filter.listId, ...(filter.reminderLocationId ? { id: filter.reminderLocationId } : {}) };
  await tx.notificationEmailDelivery.updateMany({
    where: {
      status: "PENDING",
      kind: "PRIMARY",
      OR: [
        { notification: { reminderOccurrence: { reminderLocation } } },
        { notification: { complianceReminderLocation: reminderLocation } },
        { reminderEmailEvent: { reminderLocation } },
      ],
    },
    data: { status: "SKIPPED", claimToken: null, leaseExpiresAt: null, lastError: null },
  });
}

const hasReminderRecipients = [
  { recipients: { some: { user: { active: true } } } },
  { emailRecipients: { some: {} } },
];

const dueWhere = (today: Date): Prisma.NotificationReminderLocationWhereInput => ({
  hidden: false,
  referenceOn: { not: null },
  nextDueOn: { lte: today },
  list: { active: true, complianceKind: null },
  OR: [
    { useLocationRecipients: true, OR: hasReminderRecipients },
    { list: { OR: hasReminderRecipients }, OR: [{ useLocationRecipients: false }, { list: { includeCategoryRecipients: true } }] },
  ],
  location: { active: true },
});

export async function runNotificationReminderScan(args?: { today?: Date; limit?: number; timeBudgetMs?: number }, dependencies?: {
  db?: PrismaClient;
  notify?: typeof createNotificationForUsers;
  schedule?: typeof scheduleNotificationEmails;
  isDemo?: () => Promise<boolean>;
}) {
  const result = { ok: true, scanned: 0, occurrences: 0, notifications: 0, emailDeliveries: 0, skipped: 0, demo: false, incomplete: false };
  if (await (dependencies?.isDemo ?? isDemoModeActiveForRequest)()) return { ...result, demo: true };
  const db = dependencies?.db ?? prisma;
  const notify = dependencies?.notify ?? createNotificationForUsers;
  const today = args?.today ? parseReminderDate(args.today) : reminderToday();
  if (!today) throw new Error("Invalid reminder scan date.");
  const started = Date.now();
  const limit = Math.max(1, Math.min(args?.limit ?? 5000, 10_000));
  const timeBudgetMs = Math.max(1, Math.min(args?.timeBudgetMs ?? 90_000, 180_000));
  const notificationIds: string[] = [];
  let cursor: { date: Date; id: string } | null = null;
  let complete = false;
  scan: while (result.scanned < limit && Date.now() - started < timeBudgetMs) {
    const take = Math.min(100, limit - result.scanned);
    const rows: Array<{ id: string; listId: string; nextDueOn: Date | null }> = await db.notificationReminderLocation.findMany({
      where: { AND: [dueWhere(today), ...(cursor ? [{ OR: [
        { nextDueOn: { gt: cursor.date } },
        { nextDueOn: cursor.date, id: { gt: cursor.id } },
      ] }] : [])] },
      select: { id: true, listId: true, nextDueOn: true },
      orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
      take,
    });
    if (!rows.length) { complete = true; break; }
    for (const candidate of rows) {
      if (Date.now() - started >= timeBudgetMs) break scan;
      cursor = { date: candidate.nextDueOn!, id: candidate.id };
      result.scanned++;
      try {
        const generated = await db.$transaction(async (tx) => {
          await lockNotificationReminderList(tx, candidate.listId);
          const row = await tx.notificationReminderLocation.findFirst({
            where: { id: candidate.id, ...dueWhere(today) },
            include: { list: { include: reminderRecipientSelection }, ...reminderRecipientSelection, location: true, company: true },
          });
          if (!row?.referenceOn || !row.nextDueOn) return null;
          const months = row.intervalMonths ?? row.list.defaultIntervalMonths;
          const nextDueOn = nextReminderAfter(row.referenceOn, months, today);
          const moved = await tx.notificationReminderLocation.updateMany({
            where: { AND: [dueWhere(today), {
              id: row.id, listId: row.listId, nextDueOn: row.nextDueOn,
              referenceOn: row.referenceOn, intervalMonths: row.intervalMonths,
              companyId: row.companyId,
            }] },
            data: { nextDueOn },
          });
          if (!moved.count) return null;
          // Editing an anchor back to an already-notified cycle never replays it.
          const existing = await tx.notificationReminderOccurrence.findUnique({
            where: { reminderLocationId_dueOn: { reminderLocationId: row.id, dueOn: row.nextDueOn } },
            select: { id: true },
          });
          if (existing) return null;
          const occurrence = await tx.notificationReminderOccurrence.create({
            data: {
              reminderLocationId: row.id, dueOn: row.nextDueOn,
              referenceOn: row.referenceOn, intervalMonths: months, companyId: row.companyId,
            },
          });
          const { userIds, contactIds } = reminderDeliveryRecipients(row.list, row);
          const locationLabel = row.location.locationNumber ? `${row.location.locationNumber} - ${row.location.name}` : row.location.name;
          const dueOn = formatReminderDate(row.nextDueOn);
          const title = `${row.list.name}: ${locationLabel}`;
          const body = [
            `Reminder list: ${row.list.name}`,
            `Location: ${locationLabel}`,
            `Company: ${row.company?.name ?? "Not assigned"}`,
            `Date entered: ${formatReminderDate(row.referenceOn)}`,
            `Reminder due: ${dueOn}`,
            `Repeats every ${months} month${months === 1 ? "" : "s"} from the entered date.`,
            `Next reminder: ${formatReminderDate(nextDueOn)}`,
          ].join("\n");
          const ids = userIds.length ? await notify({
            userIds, type: "SCHEDULER", title, body, href: "/notifications", reminderOccurrenceId: occurrence.id,
          }, { tx, scheduleEmails: false }) : [];
          const emailEventIds = await queueReminderEmailEvents(tx, {
            contactIds, title, body, reminderLocationId: row.id, reminderOccurrenceId: occurrence.id,
            dedupeKey: `reminder:${row.id}:${dueOn}`, referenceOn: row.referenceOn, intervalMonths: months,
          });
          if (!ids.length && !emailEventIds.length) throw new NoReminderRecipients("No active recipients are available.");
          await tx.auditLog.create({ data: {
            module: "NOTIFICATION_REMINDERS", action: "GENERATE_REMINDER",
            entityType: "NotificationReminderOccurrence", entityId: occurrence.id,
            message: `Generated ${row.list.name} reminder for ${locationLabel}.`,
            metadata: { listId: row.listId, reminderLocationId: row.id, locationId: row.locationId, companyId: row.companyId, dueOn, reminderEmailEventIds: emailEventIds },
          } });
          return { ids, emailDeliveries: emailEventIds.length };
        }, { maxWait: 10_000, timeout: 30_000 });
        if (generated) {
          result.occurrences++;
          result.notifications += generated.ids.length;
          result.emailDeliveries += generated.emailDeliveries;
          notificationIds.push(...generated.ids);
        } else result.skipped++;
      } catch (error) {
        if (error instanceof NoReminderRecipients) { result.skipped++; continue; }
        throw error;
      }
    }
    if (rows.length < take) { complete = true; break; }
  }
  result.incomplete = !complete;
  (dependencies?.schedule ?? scheduleNotificationEmails)(notificationIds);
  return result;
}

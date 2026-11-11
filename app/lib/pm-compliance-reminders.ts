import { prisma } from "@/app/lib/prisma";
import { createNotificationForUsers } from "@/app/lib/workflow-foundations";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";
import { formatReminderDate, reminderSchedule, reminderToday } from "@/app/lib/reminder-dates";
import { queueReminderEmailEvents, reminderDeliveryRecipients, reminderRecipientSelection } from "@/app/lib/reminder-email-events";
import { lockNotificationReminderList } from "@/app/lib/notification-reminders";
import { scheduleNotificationEmails } from "@/app/lib/notification-email";
import { loadLatestComplianceRecords } from "@/app/lib/compliance-history";
import { latestComplianceRecords } from "@/app/lib/compliance-history-fields";

export async function runPmComplianceReminderScan(args?: { dueSoonDays?: number }) {
  const requestedDays = args?.dueSoonDays ?? 30;
  const dueSoonDays = Number.isFinite(requestedDays) ? Math.max(1, Math.min(366, Math.trunc(requestedDays))) : 30;
  const today = reminderToday();
  const dueSoonLimit = new Date(today);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + dueSoonDays);
  const [sections, assignments, history] = await Promise.all([
    prisma.notificationReminderList.findMany({ where: { active: true, complianceKind: { not: null } }, select: { id: true, defaultIntervalMonths: true } }),
    loadMaintenancePrimaryAssignments(),
    loadLatestComplianceRecords({ activeBuiltinsOnly: true }),
  ]);
  const defaults = new Map(sections.map(({ id, defaultIntervalMonths }) => [id, defaultIntervalMonths]));
  const primaryByLocation = new Map<string, string[]>();
  for (const assignment of assignments) {
    const users = primaryByLocation.get(assignment.locationId) ?? [];
    if (!users.includes(assignment.userId)) users.push(assignment.userId);
    primaryByLocation.set(assignment.locationId, users);
  }
  const totals = { ok: true, scanned: 0, created: 0, emailDeliveries: 0, dueSoon: 0, overdue: 0, skippedNoRecipients: 0, dueSoonDays };
  const notificationIds: string[] = [];
  for (const initial of history) {
    const sectionDefault = defaults.get(initial.sectionId);
    const initialDue = sectionDefault && reminderSchedule(initial.serviceDate, initial.intervalText, sectionDefault);
    if (!initialDue || initialDue.nextDueOn > dueSoonLimit) continue;
    const result = await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, initial.sectionId);
      const currentSection = await tx.notificationReminderList.findUnique({ where: { id: initial.sectionId }, include: reminderRecipientSelection });
      if (!currentSection?.active || !currentSection.complianceKind) return null;
      await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${initial.locationId} FOR UPDATE`;
      const location = await tx.location.findFirst({ where: { id: initial.locationId, active: true }, select: { id: true, name: true } });
      if (!location) return null;
      const routing = await tx.notificationReminderLocation.findUnique({
        where: { id: initial.reminderLocationId }, include: reminderRecipientSelection,
      });
      if (!routing || routing.hidden || routing.listId !== currentSection.id || routing.locationId !== location.id) return null;
      // Recheck after locking settings so edits to annual service facts cannot
      // race a scan and generate reminders from an obsolete service date.
      const currentHistory = await tx.complianceServiceEntry.findMany({
        where: { reminderLocationId: routing.id, supersededBy: null },
        select: { id: true, reminderLocationId: true, serviceDate: true, intervalText: true, recordedAt: true, recordYear: true, companyName: true },
      });
      const record = latestComplianceRecords(currentHistory)[0];
      const service = record && reminderSchedule(record.serviceDate, record.intervalText, currentSection.defaultIntervalMonths);
      if (!service || service.nextDueOn > dueSoonLimit) return null;
      const { userIds, contactIds } = reminderDeliveryRecipients(currentSection, routing, primaryByLocation.get(location.id));
      if (!userIds.length && !contactIds.length) return { ids: [], emailDeliveries: 0, skipped: true, overdue: false };
      const { referenceOn, intervalMonths, nextDueOn } = service;
      const lastService = formatReminderDate(referenceOn);
      const overdue = nextDueOn < today;
      const title = `PM Reminder ${overdue ? "Overdue" : "Due Soon"}: ${currentSection.name}`;
      const body = `${location.name} | Last service: ${lastService} | Interval: ${intervalMonths} months | Next due: ${formatReminderDate(nextDueOn)} | Service company: ${record.companyName?.trim() || "Not recorded"}`;
      const dedupeKey = `pm:${location.id}:${currentSection.complianceKind}:${lastService}:${formatReminderDate(today)}`;
      const ids = userIds.length ? await createNotificationForUsers({
        userIds, title, body, dedupeKey,
        href: `/maintenance/preventative-maintenance/compliance?year=${record.recordYear}`,
        type: "SCHEDULER", complianceReminderLocationId: routing.id,
      }, { tx, scheduleEmails: false }) : [];
      const emailEventIds = await queueReminderEmailEvents(tx, {
        contactIds, title, body, dedupeKey, referenceOn, intervalMonths,
        reminderLocationId: routing.id, complianceServiceEntryId: record.id,
      });
      if (ids.length || emailEventIds.length) await tx.auditLog.create({ data: {
        module: "PREVENTATIVE_MAINTENANCE", action: "GENERATE_COMPLIANCE_REMINDER",
        entityType: "NotificationReminderLocation", entityId: routing.id,
        metadata: { listId: currentSection.id, locationId: location.id, complianceServiceEntryId: record.id, year: record.recordYear, complianceKind: currentSection.complianceKind, notificationIds: ids, reminderEmailEventIds: emailEventIds },
      } });
      return { ids, emailDeliveries: emailEventIds.length, skipped: false, overdue };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (!result) continue;
    if (result.skipped) { totals.skippedNoRecipients++; continue; }
    totals.scanned++;
    if (result.overdue) totals.overdue++; else totals.dueSoon++;
    totals.created += result.ids.length;
    totals.emailDeliveries += result.emailDeliveries;
    notificationIds.push(...result.ids);
  }
  scheduleNotificationEmails(notificationIds);
  return totals;
}

import { prisma } from "@/app/lib/prisma";
import { createNotificationForUsers } from "@/app/lib/workflow-foundations";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";
import { latestPmServices } from "@/app/lib/pm-compliance-rules";
import { formatReminderDate, reminderToday } from "@/app/lib/reminder-dates";
import { reminderRecipientIds } from "@/app/lib/reminder-recipients";
import { lockNotificationReminderList } from "@/app/lib/notification-reminders";
import { scheduleNotificationEmails } from "@/app/lib/notification-email";

const serviceSelect = {
  id: true, locationId: true, year: true,
  greaseTrapDatePumped: true, greaseTrapReminderMonths: true, greaseTrapCompany: true,
  backflowDateChecked: true, backflowReminderMonths: true, backflowCompany: true,
  boilerInspectionDatePrimary: true, boilerInspectionReminderMonths: true, boilerInspectionCompany: true,
  location: { select: { name: true } },
} as const;

export async function runPmComplianceReminderScan(args?: { dueSoonDays?: number }) {
  const requestedDays = args?.dueSoonDays ?? 30;
  const dueSoonDays = Number.isFinite(requestedDays) ? Math.max(1, Math.min(366, Math.trunc(requestedDays))) : 30;
  const today = reminderToday();
  const dueSoonLimit = new Date(today);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + dueSoonDays);
  const [sections, assignments, rows] = await Promise.all([
    prisma.notificationReminderList.findMany({ where: { complianceKind: { not: null } } }),
    loadMaintenancePrimaryAssignments(),
    prisma.preventativeMaintenanceEntry.findMany({ where: { location: { active: true } }, select: serviceSelect }),
  ]);
  const primaryByLocation = new Map<string, string[]>();
  for (const assignment of assignments) {
    const users = primaryByLocation.get(assignment.locationId) ?? [];
    if (!users.includes(assignment.userId)) users.push(assignment.userId);
    primaryByLocation.set(assignment.locationId, users);
  }
  const totals = { ok: true, scanned: 0, created: 0, dueSoon: 0, overdue: 0, skippedNoRecipients: 0, dueSoonDays };
  const notificationIds: string[] = [];
  for (const initial of latestPmServices(rows)) {
    const section = sections.find((item) => item.complianceKind === initial.rule.key);
    if (!section?.active) continue;
    const result = await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, section.id);
      const currentSection = await tx.notificationReminderList.findUnique({ where: { id: section.id }, include: { recipients: true } });
      if (!currentSection?.active) return null;
      await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${initial.row.locationId} FOR UPDATE`;
      const location = await tx.location.findFirst({ where: { id: initial.row.locationId, active: true }, select: { id: true } });
      if (!location) return null;
      const routing = await tx.notificationReminderLocation.upsert({
        where: { listId_locationId: { listId: section.id, locationId: location.id } },
        create: { listId: section.id, locationId: location.id }, update: {}, include: { recipients: true },
      });
      if (routing.hidden) return null;
      // Recheck after locking settings so edits to annual service facts cannot
      // race a scan and generate reminders from an obsolete service date.
      const currentRows = await tx.preventativeMaintenanceEntry.findMany({ where: { locationId: location.id }, select: serviceSelect });
      const service = latestPmServices(currentRows, { [initial.rule.key]: currentSection.defaultIntervalMonths }).find((item) => item.rule.key === initial.rule.key);
      if (!service || service.nextDueAt > dueSoonLimit) return null;
      const recipients = reminderRecipientIds({
        sectionIds: currentSection.recipients.map((recipient) => recipient.userId),
        locationIds: routing.recipients.map((recipient) => recipient.userId),
        useLocationRecipients: routing.useLocationRecipients,
        fallbackIds: primaryByLocation.get(location.id),
      });
      if (!recipients.length) return { ids: [], skipped: true, overdue: false };
      const { row, rule, lastServiceDate, intervalMonths, nextDueAt } = service;
      const overdue = nextDueAt < today;
      const ids = await createNotificationForUsers({
        userIds: recipients,
        title: `PM Reminder ${overdue ? "Overdue" : "Due Soon"}: ${currentSection.name}`,
        body: `${row.location.name} | Last service: ${formatReminderDate(lastServiceDate)} | Interval: ${intervalMonths} months | Next due: ${formatReminderDate(nextDueAt)} | Service company: ${row[rule.companyField]?.trim() || "Not recorded"}`,
        href: `/maintenance/preventative-maintenance/compliance?year=${row.year}`,
        type: "SCHEDULER", complianceReminderLocationId: routing.id,
        dedupeKey: `pm:${row.locationId}:${rule.key}:${formatReminderDate(lastServiceDate)}:${formatReminderDate(today)}`,
      }, { tx, scheduleEmails: false });
      if (ids.length) await tx.auditLog.create({ data: {
        module: "PREVENTATIVE_MAINTENANCE", action: "GENERATE_COMPLIANCE_REMINDER",
        entityType: "NotificationReminderLocation", entityId: routing.id,
        metadata: { listId: currentSection.id, locationId: row.locationId, preventativeMaintenanceEntryId: row.id, year: row.year, complianceKind: rule.key, notificationIds: ids },
      } });
      return { ids, skipped: false, overdue };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (!result) continue;
    if (result.skipped) { totals.skippedNoRecipients++; continue; }
    totals.scanned++;
    if (result.overdue) totals.overdue++; else totals.dueSoon++;
    totals.created += result.ids.length;
    notificationIds.push(...result.ids);
  }
  scheduleNotificationEmails(notificationIds);
  return totals;
}

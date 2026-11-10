import { prisma } from "@/app/lib/prisma";
import { createNotificationForUsers } from "@/app/lib/workflow-foundations";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";
import { latestPmServices } from "@/app/lib/pm-compliance-rules";
import { formatReminderDate, reminderToday } from "@/app/lib/reminder-dates";
import { reminderRecipientIds } from "@/app/lib/reminder-recipients";
import { lockNotificationReminderList } from "@/app/lib/notification-reminders";
import { scheduleNotificationEmails } from "@/app/lib/notification-email";
import { loadLatestComplianceRecords } from "@/app/lib/compliance-history";
import { latestComplianceRecords } from "@/app/lib/compliance-history-fields";
import type { PmComplianceEntry } from "@/app/lib/pm-compliance-rules";

function historyRow(record: {id: string; serviceDate: string; intervalText: string | null; companyName: string | null; recordYear: number}, kind: "GREASE_TRAP" | "BACKFLOW" | "BOILER", locationId: string, locationName: string): PmComplianceEntry {
  return {
    id: record.id, locationId, year: record.recordYear, location: {name: locationName},
    greaseTrapDatePumped: kind === "GREASE_TRAP" ? record.serviceDate : null,
    greaseTrapReminderMonths: kind === "GREASE_TRAP" ? record.intervalText : null,
    greaseTrapCompany: kind === "GREASE_TRAP" ? record.companyName : null,
    backflowDateChecked: kind === "BACKFLOW" ? record.serviceDate : null,
    backflowReminderMonths: kind === "BACKFLOW" ? record.intervalText : null,
    backflowCompany: kind === "BACKFLOW" ? record.companyName : null,
    boilerInspectionDatePrimary: kind === "BOILER" ? record.serviceDate : null,
    boilerInspectionReminderMonths: kind === "BOILER" ? record.intervalText : null,
    boilerInspectionCompany: kind === "BOILER" ? record.companyName : null,
  };
}

export async function runPmComplianceReminderScan(args?: { dueSoonDays?: number }) {
  const requestedDays = args?.dueSoonDays ?? 30;
  const dueSoonDays = Number.isFinite(requestedDays) ? Math.max(1, Math.min(366, Math.trunc(requestedDays))) : 30;
  const today = reminderToday();
  const dueSoonLimit = new Date(today);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + dueSoonDays);
  const [sections, assignments, history] = await Promise.all([
    prisma.notificationReminderList.findMany({ where: { complianceKind: { not: null } } }),
    loadMaintenancePrimaryAssignments(),
    loadLatestComplianceRecords(),
  ]);
  const rows = history.flatMap(record => record.complianceKind ? [historyRow(record, record.complianceKind, record.locationId, record.locationName)] : []);
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
      const currentHistory = await tx.complianceServiceEntry.findMany({where: {reminderLocationId: routing.id, supersededBy: null}});
      const currentRows = latestComplianceRecords(currentHistory).map(record => historyRow(record, initial.rule.key, location.id, initial.row.location.name));
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
        metadata: { listId: currentSection.id, locationId: row.locationId, complianceServiceEntryId: row.id, year: row.year, complianceKind: rule.key, notificationIds: ids },
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

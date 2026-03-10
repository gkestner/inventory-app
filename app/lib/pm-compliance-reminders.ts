import { prisma } from "@/app/lib/prisma";
import { createNotification } from "@/app/lib/workflow-foundations";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

type ReminderStatus = "DUE_SOON" | "OVERDUE";

type ReminderRule = {
  key: "GREASE_TRAP" | "BACKFLOW" | "BOILER";
  label: string;
  dateField: "greaseTrapDatePumped" | "backflowDateChecked" | "boilerInspectionDatePrimary";
  monthsField: "greaseTrapReminderMonths" | "backflowReminderMonths" | "boilerInspectionReminderMonths";
};

type EntryRow = {
  locationId: string;
  year: number;
  greaseTrapDatePumped: string | null;
  greaseTrapReminderMonths: string | null;
  backflowDateChecked: string | null;
  backflowReminderMonths: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionReminderMonths: string | null;
  location: { name: string };
};

const RULES: ReminderRule[] = [
  {
    key: "GREASE_TRAP",
    label: "Grease Trap Pumping",
    dateField: "greaseTrapDatePumped",
    monthsField: "greaseTrapReminderMonths",
  },
  {
    key: "BACKFLOW",
    label: "Backflow Inspection",
    dateField: "backflowDateChecked",
    monthsField: "backflowReminderMonths",
  },
  {
    key: "BOILER",
    label: "Boiler Inspection",
    dateField: "boilerInspectionDatePrimary",
    monthsField: "boilerInspectionReminderMonths",
  },
];

function parseMonths(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const months = Math.trunc(n);
  if (months <= 0 || months > 120) return null;
  return months;
}

function parseDate(raw: string | null | undefined): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runPmComplianceReminderScan(args?: { dueSoonDays?: number }) {
  const dueSoonDays = Math.max(1, Math.trunc(args?.dueSoonDays ?? 30));
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const dueSoonLimit = new Date(today);
  dueSoonLimit.setDate(dueSoonLimit.getDate() + dueSoonDays);

  const assignments = await loadMaintenancePrimaryAssignments();
  const locationToUsers = new Map<string, string[]>();
  for (const a of assignments) {
    const users = locationToUsers.get(a.locationId) ?? [];
    if (!users.includes(a.userId)) users.push(a.userId);
    locationToUsers.set(a.locationId, users);
  }

  const locationIds = Array.from(locationToUsers.keys());
  if (locationIds.length === 0) {
    return {
      ok: true,
      scanned: 0,
      created: 0,
      dueSoon: 0,
      overdue: 0,
      skippedNoRecipients: 0,
    };
  }

  const rows = (await prisma.preventativeMaintenanceEntry.findMany({
    where: { locationId: { in: locationIds } },
    select: {
      locationId: true,
      year: true,
      greaseTrapDatePumped: true,
      greaseTrapReminderMonths: true,
      backflowDateChecked: true,
      backflowReminderMonths: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionReminderMonths: true,
      location: { select: { name: true } },
    },
  })) as EntryRow[];

  const dedupeAfter = new Date(today);

  let scanned = 0;
  let created = 0;
  let dueSoon = 0;
  let overdue = 0;
  let skippedNoRecipients = 0;

  for (const row of rows) {
    const recipients = locationToUsers.get(row.locationId) ?? [];
    if (recipients.length === 0) {
      skippedNoRecipients += 1;
      continue;
    }

    for (const rule of RULES) {
      const lastServiceDate = parseDate(row[rule.dateField]);
      const intervalMonths = parseMonths(row[rule.monthsField]);
      if (!lastServiceDate || !intervalMonths) continue;

      const nextDueAt = addMonths(lastServiceDate, intervalMonths);
      let status: ReminderStatus | null = null;

      if (nextDueAt < today) {
        status = "OVERDUE";
        overdue += 1;
      } else if (nextDueAt <= dueSoonLimit) {
        status = "DUE_SOON";
        dueSoon += 1;
      }

      if (!status) continue;
      scanned += 1;

      const title =
        status === "OVERDUE"
          ? `PM Reminder Overdue: ${rule.label}`
          : `PM Reminder Due Soon: ${rule.label}`;

      const body =
        `${row.location.name} | Last service: ${isoDate(lastServiceDate)} | ` +
        `Interval: ${intervalMonths} months | Next due: ${isoDate(nextDueAt)}`;

      const href = `/maintenance/preventative-maintenance/compliance?year=${row.year}`;

      for (const userId of recipients) {
        const exists = await prisma.notification.findFirst({
          where: {
            userId,
            title,
            href,
            createdAt: { gte: dedupeAfter },
          },
          select: { id: true },
        });
        if (exists) continue;

        await createNotification({
          userId,
          title,
          body,
          href,
          type: "SCHEDULER",
        });
        created += 1;
      }
    }
  }

  return {
    ok: true,
    scanned,
    created,
    dueSoon,
    overdue,
    skippedNoRecipients,
    dueSoonDays,
  };
}

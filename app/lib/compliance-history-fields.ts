import type { ComplianceSectionKind } from "@prisma/client";
import { parseReminderDate, parseReminderMonths } from "@/app/lib/reminder-dates";

export type ComplianceHistoryRecord = {
  id: string; reminderLocationId: string; sectionId: string; sectionName: string;
  complianceKind: ComplianceSectionKind | null; locationId: string; locationName: string;
  locationNumber: string | null; recordYear: number; serviceDate: string;
  intervalMonths: number; intervalOverrideMonths: number | null; intervalText: string | null;
  companyName: string; cost: string | null; tankSize: string | null; gallons: string | null;
  additionalDate: string | null; notes: string | null; recordedAt: Date;
  recordedByName: string | null; source: string;
};

export type ComplianceServiceValues = Pick<ComplianceHistoryRecord,
  "serviceDate" | "intervalMonths" | "intervalOverrideMonths" | "intervalText" | "companyName" | "cost" | "tankSize" | "gallons" | "additionalDate" | "notes">;

const text = (value: unknown) => String(value ?? "").trim();
export function complianceValuesFromAnnual(kind: ComplianceSectionKind, row: Record<string, unknown>, fallback: number): ComplianceServiceValues {
  const prefix = kind === "GREASE_TRAP" ? "greaseTrap" : kind === "BACKFLOW" ? "backflow" : "boilerInspection";
  const intervalText = text(row[`${prefix}ReminderMonths`]);
  return {
    serviceDate: text(row[kind === "GREASE_TRAP" ? "greaseTrapDatePumped" : kind === "BACKFLOW" ? "backflowDateChecked" : "boilerInspectionDatePrimary"]),
    intervalMonths: parseReminderMonths(intervalText, fallback) ?? fallback,
    intervalOverrideMonths: intervalText ? parseReminderMonths(intervalText) : null,
    intervalText: intervalText || null,
    companyName: text(row[`${prefix}Company`]),
    cost: text(row[kind === "BACKFLOW" ? "backflowAmount" : `${prefix}Cost`]) || null,
    tankSize: kind === "GREASE_TRAP" ? text(row.greaseTrapTankSize) || null : null,
    gallons: kind === "GREASE_TRAP" ? text(row.greaseTrapGallons) || null : null,
    additionalDate: kind === "BOILER" ? text(row.boilerInspectionDateSecondary) || null : null,
    notes: null,
  };
}

export function hasComplianceFacts(values: ComplianceServiceValues) {
  return [values.serviceDate, values.companyName, values.cost, values.tankSize, values.gallons, values.additionalDate, values.notes, values.intervalText].some(Boolean);
}

/** One chronological anchor for dashboard/reminders; a backdated addition never moves it backwards. */
export function compareComplianceService(a: {serviceDate: string; recordedAt: Date; id: string}, b: {serviceDate: string; recordedAt: Date; id: string}) {
  const aDate = parseReminderDate(a.serviceDate)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bDate = parseReminderDate(b.serviceDate)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return bDate - aDate || b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id);
}

export function latestComplianceRecords<T extends {reminderLocationId: string; serviceDate: string; recordedAt: Date; id: string; supersedesEntryId?: string | null}>(records: T[]): T[] {
  const latest = new Map<string, T>();
  const corrected = new Set(records.flatMap(record => record.supersedesEntryId ? [record.supersedesEntryId] : []));
  for (const record of records) {
    if (corrected.has(record.id)) continue;
    const previous = latest.get(record.reminderLocationId);
    if (!previous || compareComplianceService(record, previous) < 0) latest.set(record.reminderLocationId, record);
  }
  return [...latest.values()];
}

export function parsedComplianceSubmission(form: FormData, defaultMonths: number): {values?: ComplianceServiceValues; error?: string} {
  const value = (name: string) => text(form.get(name));
  const serviceDate = value("serviceDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !parseReminderDate(serviceDate)) return { error: "Enter a valid service date for the new entry." };
  const intervalText = value("intervalMonths");
  const intervalMonths = parseReminderMonths(intervalText, defaultMonths);
  if (!intervalMonths) return { error: "Reminder intervals must be whole numbers from 1 to 120 months." };
  const additionalDate = value("additionalDate");
  if (additionalDate && (!/^\d{4}-\d{2}-\d{2}$/.test(additionalDate) || !parseReminderDate(additionalDate))) return { error: "Enter a valid additional inspection date." };
  const companyName = value("companyName").replace(/\s+/g, " ");
  if (companyName.length > 160) return { error: "Use a company name of at most 160 characters." };
  for (const name of ["cost", "tankSize", "gallons", "notes"]) if (value(name).length > 2000) return { error: "Use at most 2000 characters in each compliance field." };
  return { values: { serviceDate, intervalMonths, intervalOverrideMonths: intervalText ? intervalMonths : null, intervalText: intervalText || null,
    companyName, cost: value("cost") || null, tankSize: value("tankSize") || null, gallons: value("gallons") || null,
    additionalDate: additionalDate || null, notes: value("notes") || null } };
}

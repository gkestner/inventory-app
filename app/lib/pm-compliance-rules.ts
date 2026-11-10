import { parseReminderDate, parseReminderMonths, addReminderMonths } from "@/app/lib/reminder-dates";

export type PmComplianceEntry = {
  id: string;
  locationId: string;
  year: number;
  greaseTrapDatePumped: string | null;
  greaseTrapReminderMonths: string | null;
  greaseTrapCompany: string | null;
  backflowDateChecked: string | null;
  backflowReminderMonths: string | null;
  backflowCompany: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionReminderMonths: string | null;
  boilerInspectionCompany: string | null;
  location: { name: string };
};

export const PM_REMINDER_RULES = [
  {
    key: "GREASE_TRAP", label: "Grease Trap Pumping", dateField: "greaseTrapDatePumped",
    monthsField: "greaseTrapReminderMonths", companyField: "greaseTrapCompany",
  },
  {
    key: "BACKFLOW", label: "Backflow Inspection", dateField: "backflowDateChecked",
    monthsField: "backflowReminderMonths", companyField: "backflowCompany",
  },
  {
    key: "BOILER", label: "Boiler Inspection", dateField: "boilerInspectionDatePrimary",
    monthsField: "boilerInspectionReminderMonths", companyField: "boilerInspectionCompany",
  },
] as const;

/** Only the latest actual service date per location/type drives reminders, across all annual records. */
export function latestPmServices(rows: PmComplianceEntry[], sectionDefaults?: Partial<Record<typeof PM_REMINDER_RULES[number]["key"], number>>) {
  const latest = new Map<string, { row: PmComplianceEntry; rule: typeof PM_REMINDER_RULES[number]; lastServiceDate: Date }>();
  for (const row of rows) {
    for (const rule of PM_REMINDER_RULES) {
      const lastServiceDate = parseReminderDate(row[rule.dateField]);
      if (!lastServiceDate) continue;
      const key = `${row.locationId}:${rule.key}`;
      const previous = latest.get(key);
      if (!previous || lastServiceDate > previous.lastServiceDate ||
        (lastServiceDate.getTime() === previous.lastServiceDate.getTime() && row.year > previous.row.year)) {
        latest.set(key, { row, rule, lastServiceDate });
      }
    }
  }
  return Array.from(latest.values()).flatMap((service) => {
    const intervalMonths = parseReminderMonths(service.row[service.rule.monthsField], sectionDefaults?.[service.rule.key]);
    return intervalMonths ? [{
      ...service, intervalMonths, nextDueAt: addReminderMonths(service.lastServiceDate, intervalMonths),
    }] : [];
  });
}

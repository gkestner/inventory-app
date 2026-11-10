import type { ComplianceSectionKind } from "@prisma/client";
import type { PreventativeMaintenanceValues } from "@/app/lib/preventative-maintenance";
import { parseReminderDate, parseReminderMonths } from "@/app/lib/reminder-dates";

export const COMPLIANCE_FIELDS = {
  GREASE_TRAP: ["greaseTrapDatePumped", "greaseTrapReminderMonths", "greaseTrapCompany", "greaseTrapTankSize", "greaseTrapCost", "greaseTrapGallons"],
  BACKFLOW: ["backflowDateChecked", "backflowReminderMonths", "backflowCompany", "backflowAmount"],
  BOILER: ["boilerInspectionDatePrimary", "boilerInspectionReminderMonths", "boilerInspectionCompany", "boilerInspectionCost", "boilerInspectionDateSecondary"],
} as const;

/** Update only submitted fields in this section, preserving every other annual fact. */
export function submittedComplianceValues(form: FormData, kind: ComplianceSectionKind): {
  values: Partial<PreventativeMaintenanceValues>; error?: string;
} {
  const values: Partial<PreventativeMaintenanceValues> = {};
  for (const field of COMPLIANCE_FIELDS[kind]) {
    if (!form.has(field)) continue;
    const value = String(form.get(field) ?? "").trim();
    if (value.length > 2000) return { values: {}, error: "Use at most 2000 characters in each compliance field." };
    if (field.includes("Date") && value && !parseReminderDate(value)) return { values: {}, error: "Enter a valid service date or leave it blank." };
    if (field.endsWith("ReminderMonths") && value && !parseReminderMonths(value)) return { values: {}, error: "Reminder intervals must be whole numbers from 1 to 120 months." };
    values[field] = value;
  }
  return { values };
}

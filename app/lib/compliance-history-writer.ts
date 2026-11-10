import type { NotificationReminderList, NotificationReminderLocation, Prisma } from "@prisma/client";
import { latestComplianceRecords, type ComplianceServiceValues } from "@/app/lib/compliance-history-fields";
import { addReminderMonths, parseReminderDate } from "@/app/lib/reminder-dates";
import { savePreventativeMaintenanceEntryWithAudit, type PreventativeMaintenanceValues } from "@/app/lib/preventative-maintenance";

export class ComplianceHistoryInputError extends Error {}

/** Caller holds the section then location locks in its surrounding transaction. */
export async function recordComplianceServiceEntry(tx: Prisma.TransactionClient, args: {
  section: NotificationReminderList; routing: NotificationReminderLocation; actorUserId: string;
  year: number; submissionToken: string; values: ComplianceServiceValues;
}) {
  const {section, routing, values} = args;
  const previous = await tx.complianceServiceEntry.findUnique({where: {submissionToken: args.submissionToken}});
  if (previous) {
    const same = previous.reminderLocationId === routing.id && previous.recordedByUserId === args.actorUserId && previous.recordYear === args.year &&
      Object.entries(values).every(([key, value]) => (previous[key as keyof typeof previous] ?? "") === (value ?? ""));
    if (!same) throw new ComplianceHistoryInputError("This entry was already submitted with different details. Refresh before adding another entry.");
    return {entry: previous, created: false, anchorChanged: false};
  }
  const company = values.companyName ? await tx.reminderCompany.upsert({
    where: {normalizedName: values.companyName.normalize("NFKC").toLocaleLowerCase("en-US")},
    create: {name: values.companyName, normalizedName: values.companyName.normalize("NFKC").toLocaleLowerCase("en-US")}, update: {},
  }) : null;
  let sourceAnnualEntryId: string | null = null;
  if (section.complianceKind) {
    const prefix = section.complianceKind === "GREASE_TRAP" ? "greaseTrap" : section.complianceKind === "BACKFLOW" ? "backflow" : "boilerInspection";
    const dateField = section.complianceKind === "GREASE_TRAP" ? "greaseTrapDatePumped" : section.complianceKind === "BACKFLOW" ? "backflowDateChecked" : "boilerInspectionDatePrimary";
    const annual = await tx.preventativeMaintenanceEntry.findUnique({where: {locationId_year: {locationId: routing.locationId, year: args.year}}});
    const annualDate = parseReminderDate(annual?.[dateField]);
    const incomingDate = parseReminderDate(values.serviceDate)!;
    // A backdated event belongs in history without replacing a later annual fact.
    if (!annualDate || incomingDate >= annualDate) {
      const annualValues: Partial<PreventativeMaintenanceValues> = {
        [dateField]: values.serviceDate, [`${prefix}ReminderMonths`]: values.intervalText ?? "",
        [`${prefix}Company`]: values.companyName,
        [section.complianceKind === "BACKFLOW" ? "backflowAmount" : `${prefix}Cost`]: values.cost ?? "",
        ...(section.complianceKind === "GREASE_TRAP" ? {greaseTrapTankSize: values.tankSize ?? "", greaseTrapGallons: values.gallons ?? ""} : {}),
        ...(section.complianceKind === "BOILER" ? {boilerInspectionDateSecondary: values.additionalDate ?? ""} : {}),
      };
      const companyField = `${prefix}CompanyId` as "greaseTrapCompanyId" | "backflowCompanyId" | "boilerInspectionCompanyId";
      const result = await savePreventativeMaintenanceEntryWithAudit({locationId: routing.locationId, year: args.year, values: annualValues, actorUserId: args.actorUserId, source: "ADMIN"}, {tx, skipComplianceHistory: true, companyIds: {[companyField]: company?.id ?? null}});
      sourceAnnualEntryId = result.saved.id;
    }
  }
  const entry = await tx.complianceServiceEntry.create({data: {
    reminderLocationId: routing.id, sourceAnnualEntryId, recordedByUserId: args.actorUserId,
    companyId: company?.id ?? null, recordYear: args.year, submissionToken: args.submissionToken,
    source: "DASHBOARD", ...values,
  }});
  const candidates = await tx.complianceServiceEntry.findMany({where: {reminderLocationId: routing.id, supersededBy: null}});
  const current = latestComplianceRecords(candidates)[0];
  const anchorChanged = current?.id === entry.id;
  if (anchorChanged) {
    const referenceOn = parseReminderDate(values.serviceDate)!;
    await tx.notificationReminderLocation.update({where: {id: routing.id}, data: {
      referenceOn, nextDueOn: addReminderMonths(referenceOn, values.intervalMonths),
      intervalMonths: values.intervalOverrideMonths, companyId: company?.id ?? null,
    }});
  }
  await tx.auditLog.create({data: {
    actorUserId: args.actorUserId, module: "PREVENTATIVE_MAINTENANCE", action: "ADD_COMPLIANCE_SERVICE",
    entityType: "ComplianceServiceEntry", entityId: entry.id,
    metadata: {complianceServiceEntryId: entry.id, reminderLocationId: routing.id, listId: section.id, locationId: routing.locationId, sourceAnnualEntryId, recordYear: args.year, anchorChanged},
  }});
  return {entry, created: true, anchorChanged};
}

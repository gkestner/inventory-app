import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { complianceValuesFromAnnual, hasComplianceFacts, latestComplianceRecords, type ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { COMPLIANCE_FIELDS } from "@/app/lib/compliance-fields";

const relations = {
  reminderLocation: { include: { list: true, location: { select: { id: true, name: true, locationNumber: true } } } },
  recordedByUser: { select: { name: true } },
} as const;
type HistoryRow = Prisma.ComplianceServiceEntryGetPayload<{include: typeof relations}>;

function present(row: HistoryRow): ComplianceHistoryRecord {
  return { id: row.id, reminderLocationId: row.reminderLocationId,
    sectionId: row.reminderLocation.listId, sectionName: row.reminderLocation.list.name,
    complianceKind: row.reminderLocation.list.complianceKind, locationId: row.reminderLocation.locationId,
    locationName: row.reminderLocation.location.name, locationNumber: row.reminderLocation.location.locationNumber,
    serviceDate: row.serviceDate, recordYear: row.recordYear, intervalMonths: row.intervalMonths,
    intervalOverrideMonths: row.intervalOverrideMonths, intervalText: row.intervalText,
    companyName: row.companyName ?? "", cost: row.cost, tankSize: row.tankSize, gallons: row.gallons,
    additionalDate: row.additionalDate, notes: row.notes, recordedAt: row.recordedAt,
    recordedByName: row.recordedByUser?.name ?? null, source: row.source };
}

export async function loadComplianceHistory(options?: { locationId?: string; sectionId?: string; year?: number; page?: number; pageSize?: number; recordedBefore?: Date }) {
  const requestedPage = Math.max(1, Math.trunc(options?.page ?? 1));
  const pageSize = Math.max(1, Math.min(1000, Math.trunc(options?.pageSize ?? 50)));
  const where: Prisma.ComplianceServiceEntryWhereInput = {
    ...(options?.year ? { recordYear: options.year } : {}),
    ...(options?.recordedBefore ? { recordedAt: { lte: options.recordedBefore } } : {}),
    reminderLocation: { ...(options?.locationId ? {locationId: options.locationId} : {}), ...(options?.sectionId ? {listId: options.sectionId} : {}) },
  };
  return prisma.$transaction(async tx => {
    const total = await tx.complianceServiceEntry.count({where});
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await tx.complianceServiceEntry.findMany({where, include: relations, orderBy: [{recordedAt: "desc"}, {id: "desc"}], skip: (page - 1) * pageSize, take: pageSize});
    return {records: rows.map(present), total, page, pageSize};
  }, {isolationLevel: "RepeatableRead"});
}

export async function loadLatestComplianceRecords(locationIds?: string[]) {
  const rows = await prisma.complianceServiceEntry.findMany({
    where: { supersededBy: null, ...(locationIds ? {reminderLocation: {locationId: {in: locationIds}}} : {}) }, include: relations,
  });
  return latestComplianceRecords(rows).map(present);
}

/** Called inside the same transaction as every legacy annual writer. */
export async function appendAnnualComplianceHistory(tx: Prisma.TransactionClient, args: {
  saved: {id: string} & Record<string, unknown>; locationId: string; year: number; actorUserId: string;
  changedFields: string[]; sourceAuditLogId: string;
}) {
  const sections = await tx.notificationReminderList.findMany({where: {complianceKind: {not: null}}});
  for (const section of sections) {
    const kind = section.complianceKind!;
    if (!COMPLIANCE_FIELDS[kind].some(field => args.changedFields.includes(field))) continue;
    const values = complianceValuesFromAnnual(kind, args.saved, section.defaultIntervalMonths);
    const routing = await tx.notificationReminderLocation.upsert({where: {listId_locationId: {listId: section.id, locationId: args.locationId}}, create: {listId: section.id, locationId: args.locationId}, update: {}});
    const previous = await tx.complianceServiceEntry.findFirst({where: {reminderLocationId: routing.id, sourceAnnualEntryId: args.saved.id, supersededBy: null}, orderBy: [{recordedAt: "desc"}, {id: "desc"}]});
    if (!previous && !hasComplianceFacts(values)) continue;
    const companyField = kind === "GREASE_TRAP" ? "greaseTrapCompanyId" : kind === "BACKFLOW" ? "backflowCompanyId" : "boilerInspectionCompanyId";
    await tx.complianceServiceEntry.create({data: {
      reminderLocationId: routing.id, sourceAnnualEntryId: args.saved.id,
      sourceAuditLogId: args.sourceAuditLogId, supersedesEntryId: previous?.id,
      recordedByUserId: args.actorUserId, companyId: typeof args.saved[companyField] === "string" ? args.saved[companyField] as string : null,
      recordYear: args.year, source: "ANNUAL_EDIT", ...values,
      // Annual checklist forms cannot edit the ledger's notes field.
      notes: previous?.notes ?? values.notes,
    }});
  }
}

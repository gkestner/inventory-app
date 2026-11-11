import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";
import { loadLatestComplianceRecords } from "@/app/lib/compliance-history";

type Location = { id: string; name: string; locationNumber: string | null; defaultHidden: boolean };
const recipientSelect = { userId: true, user: { select: { name: true, active: true } } } as const;
export type ComplianceSearchParams = Record<string, string | string[] | undefined>;
export const complianceParam = (params: ComplianceSearchParams, key: string) => typeof params[key] === "string" ? params[key] : "";

export function complianceFilters(params: ComplianceSearchParams) {
  const status = complianceParam(params, "status");
  return { q: complianceParam(params, "q").trim().slice(0, 200), status: ["attention", "missing", "paused"].includes(status) ? status : "all",
    showHidden: complianceParam(params, "showHidden") === "1" };
}
export type ComplianceFilters = ReturnType<typeof complianceFilters>;

export async function loadComplianceDashboard(options: { locationIds?: string[]; editable: boolean; showHidden: boolean }) {
  const { locationIds, editable, showHidden } = options;
  const emailSelect = { contactId: true, ...(editable ? { contact: { select: { email: true } } } : {}) } as const;
  const locationFilter = !locationIds ? Prisma.empty : locationIds.length ? Prisma.sql`AND id IN (${Prisma.join(locationIds)})` : Prisma.sql`AND false`;
  const [sections, locations, companies, users, assignments, latestRecords] = await Promise.all([
    prisma.notificationReminderList.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true, name: true, description: true, complianceKind: true, sortOrder: true, defaultIntervalMonths: true,
        active: true, updatedAt: true, includeCategoryRecipients: true,
        recipients: { select: recipientSelect }, emailRecipients: { select: emailSelect },
        locations: {
          where: { location: { active: true }, ...(locationIds ? { locationId: { in: locationIds } } : {}) },
          select: { id: true, locationId: true, hidden: true, updatedAt: true, nextDueOn: true, useLocationRecipients: true,
            company: { select: { name: true } }, recipients: { select: recipientSelect }, emailRecipients: { select: emailSelect } },
        },
      },
    }),
    prisma.$queryRaw<Location[]>`SELECT id, name, "locationNumber", compliance_location_defaults_hidden("locationNumber") AS "defaultHidden"
      FROM "Location" WHERE active ${locationFilter} ORDER BY name, id`,
    editable ? prisma.reminderCompany.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    editable ? prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) : [],
    loadMaintenancePrimaryAssignments({ locationIds }),
    loadLatestComplianceRecords({ locationIds, includeHidden: showHidden }),
  ]);
  return { sections, locations, companies, users, assignments, latestRecords };
}

export type ComplianceDashboardData = Awaited<ReturnType<typeof loadComplianceDashboard>>;

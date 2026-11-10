import { prisma } from "@/app/lib/prisma";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

/** Native section settings are separate from the preserved annual compliance facts. */
export async function loadComplianceDashboard(year: number, options?: { locationIds?: string[] }) {
  const locationScope = options?.locationIds ? { id: { in: options.locationIds } } : {};
  const [sections, locations, entries, companies, users, assignments] = await Promise.all([
    prisma.notificationReminderList.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      include: {
        recipients: { select: { userId: true } },
        locations: {
          ...(options?.locationIds ? { where: { locationId: { in: options.locationIds } } } : {}),
          include: { recipients: { select: { userId: true } } },
        },
      },
    }),
    prisma.location.findMany({ where: { active: true, ...locationScope }, select: { id: true, name: true, locationNumber: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.preventativeMaintenanceEntry.findMany({
      where: { year, ...(options?.locationIds ? { locationId: { in: options.locationIds } } : {}) },
    }),
    prisma.reminderCompany.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    loadMaintenancePrimaryAssignments(),
  ]);
  return { sections, locations, entries, companies, users, assignments };
}

export type ComplianceDashboardData = Awaited<ReturnType<typeof loadComplianceDashboard>>;

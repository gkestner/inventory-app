import { prisma } from "@/app/lib/prisma";

export type MaintenanceRequestAssignee = {
  locationId: string;
  locationName: string;
  userId: string;
  userName: string;
  userEmail: string;
};

export type MaintenanceRequestStatusValue = "OPEN" | "RESOLVED" | "ARCHIVED";

export function normalizeMaintenanceRequestStatus(raw: string | null | undefined): MaintenanceRequestStatusValue {
  const value = String(raw ?? "OPEN").trim().toUpperCase();
  if (value === "RESOLVED") return "RESOLVED";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "OPEN";
}

export async function loadMaintenanceRequestAssignees(): Promise<MaintenanceRequestAssignee[]> {
  const maintenanceTitle = await prisma.permissionTitle.findFirst({
    where: { name: { equals: "Maintenance", mode: "insensitive" }, active: true },
    select: { id: true },
  });

  const userWhere = maintenanceTitle
    ? {
        active: true,
        OR: [{ role: "MAINTENANCE" as const }, { permissionTitles: { some: { titleId: maintenanceTitle.id } } }],
      }
    : {
        active: true,
        role: "MAINTENANCE" as const,
      };

  const rows = await prisma.userLocation.findMany({
    where: {
      location: { active: true },
      user: userWhere,
    },
    orderBy: [{ location: { name: "asc" } }, { isPrimary: "desc" }, { sortOrder: "asc" }, { user: { name: "asc" } }],
    select: {
      isPrimary: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  const byLocation = new Map<
    string,
    {
      locationName: string;
      primary: MaintenanceRequestAssignee[];
      optional: MaintenanceRequestAssignee[];
    }
  >();

  for (const row of rows) {
    if (!row.location || !row.user) continue;

    const record: MaintenanceRequestAssignee = {
      locationId: row.locationId,
      locationName: row.location.name,
      userId: row.user.id,
      userName: (row.user.name ?? "").trim() || (row.user.email ?? "").trim() || "Unknown",
      userEmail: (row.user.email ?? "").trim().toLowerCase(),
    };

    const group =
      byLocation.get(row.locationId) ??
      {
        locationName: row.location.name,
        primary: [],
        optional: [],
      };

    if (row.isPrimary) group.primary.push(record);
    else group.optional.push(record);

    byLocation.set(row.locationId, group);
  }

  const out: MaintenanceRequestAssignee[] = [];
  for (const [locationId, group] of byLocation.entries()) {
    const chosen = group.primary.length > 0 ? group.primary : group.optional;
    const deduped = Array.from(new Map(chosen.map((x) => [x.userId, x] as const)).values());
    for (const row of deduped) {
      out.push({ ...row, locationId, locationName: group.locationName });
    }
  }

  return out.sort((a, b) => {
    if (a.locationName !== b.locationName) return a.locationName.localeCompare(b.locationName);
    if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
    return a.userEmail.localeCompare(b.userEmail);
  });
}

export function computeAverageResolutionHours(
  rows: Array<{ createdAt: Date; resolvedAt: Date | null }>
): number | null {
  let totalMs = 0;
  let count = 0;

  for (const row of rows) {
    if (!row.resolvedAt) continue;
    const diff = row.resolvedAt.getTime() - row.createdAt.getTime();
    if (!Number.isFinite(diff) || diff < 0) continue;
    totalMs += diff;
    count += 1;
  }

  if (count === 0) return null;
  return totalMs / count / 3_600_000;
}

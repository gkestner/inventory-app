import { prisma } from "@/app/lib/prisma";

export type PreventativeMaintenanceFieldKey =
  | "ovenCleaning"
  | "exhaustFanMotor"
  | "tanklessWaterHeater"
  | "iceMaker"
  | "greaseTrapGallons";

export const PREVENTATIVE_MAINTENANCE_FIELDS: Array<{ key: PreventativeMaintenanceFieldKey; label: string }> = [
  { key: "ovenCleaning", label: "Oven Cleaning" },
  { key: "exhaustFanMotor", label: "Exhaust Fan Motor" },
  { key: "tanklessWaterHeater", label: "Tankless Water Heater" },
  { key: "iceMaker", label: "Ice Maker" },
  { key: "greaseTrapGallons", label: "(Gallons) Grease Trap" },
];

export type PreventativeMaintenanceAssignment = {
  locationId: string;
  locationName: string;
  userId: string;
  userName: string;
  userEmail: string;
};

type Db = {
  permissionTitle: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  userLocation: {
    findMany: (args: unknown) => Promise<
      Array<{
        locationId: string;
        location: { id: string; name: string } | null;
        user: { id: string; name: string | null; email: string | null } | null;
      }>
    >;
  };
};

const db = prisma as unknown as Db;

export function normalizePmYear(raw: string | string[] | undefined): number {
  const currentYear = new Date().getFullYear();
  if (!raw) return currentYear;

  const input = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(String(input ?? "").trim());
  if (!Number.isFinite(n)) return currentYear;

  const year = Math.trunc(n);
  if (year < 2020 || year > 2100) return currentYear;
  return year;
}

export async function loadMaintenancePrimaryAssignments(): Promise<PreventativeMaintenanceAssignment[]> {
  const maintenanceTitle = await db.permissionTitle.findFirst({
    where: { name: { equals: "Maintenance", mode: "insensitive" }, active: true },
    select: { id: true },
  });

  const where = maintenanceTitle
    ? {
        isPrimary: true,
        location: { active: true },
        user: {
          active: true,
          OR: [{ role: "MAINTENANCE" }, { permissionTitles: { some: { titleId: maintenanceTitle.id } } }],
        },
      }
    : {
        isPrimary: true,
        location: { active: true },
        user: { active: true, role: "MAINTENANCE" },
      };

  const rows = await db.userLocation.findMany({
    where,
    orderBy: [{ user: { name: "asc" } }, { location: { name: "asc" } }],
    select: {
      locationId: true,
      location: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  const out: PreventativeMaintenanceAssignment[] = [];
  for (const row of rows) {
    if (!row.location || !row.user) continue;
    out.push({
      locationId: row.locationId,
      locationName: row.location.name,
      userId: row.user.id,
      userName: (row.user.name ?? "").trim() || (row.user.email ?? "").trim() || "Unknown",
      userEmail: (row.user.email ?? "").trim().toLowerCase(),
    });
  }
  return out;
}

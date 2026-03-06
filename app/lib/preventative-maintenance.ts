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

export type PreventativeMaintenanceValues = {
  ovenCleaning: string;
  exhaustFanMotor: string;
  tanklessWaterHeater: string;
  iceMaker: string;
  greaseTrapGallons: string;
};

type PreventativeMaintenancePersistedValues = {
  ovenCleaning: string | null;
  exhaustFanMotor: string | null;
  tanklessWaterHeater: string | null;
  iceMaker: string | null;
  greaseTrapGallons: string | null;
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
  location: {
    findUnique: (args: unknown) => Promise<{ id: string; name: string } | null>;
  };
  preventativeMaintenanceEntry: {
    findUnique: (args: unknown) => Promise<
      | ({ id: string; locationId: string; year: number } & PreventativeMaintenancePersistedValues)
      | null
    >;
    upsert: (args: unknown) => Promise<{ id: string } & PreventativeMaintenancePersistedValues>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function isOfficeLocationName(name: string): boolean {
  return name.trim().toLowerCase() === "office";
}

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
    if (isOfficeLocationName(row.location.name)) continue;
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

function normalizePersisted(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function collectChanges(
  before: PreventativeMaintenancePersistedValues | null,
  after: PreventativeMaintenanceValues
): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const field of PREVENTATIVE_MAINTENANCE_FIELDS) {
    const key = field.key;
    const from = normalizePersisted(before?.[key]);
    const to = normalizePersisted(after[key]);
    if (from === to) continue;
    changes[key] = { from, to };
  }
  return changes;
}

export async function savePreventativeMaintenanceEntryWithAudit(args: {
  locationId: string;
  year: number;
  values: PreventativeMaintenanceValues;
  actorUserId: string;
  source: "MAINTENANCE" | "ADMIN";
}) {
  const location = await db.location.findUnique({
    where: { id: args.locationId },
    select: { id: true, name: true },
  });
  if (!location) throw new Error("Invalid location.");

  const existing = await db.preventativeMaintenanceEntry.findUnique({
    where: { locationId_year: { locationId: args.locationId, year: args.year } },
    select: {
      id: true,
      locationId: true,
      year: true,
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
    },
  });

  const changes = collectChanges(existing, args.values);
  const hadChanges = Object.keys(changes).length > 0 || !existing;

  const saved = await db.preventativeMaintenanceEntry.upsert({
    where: { locationId_year: { locationId: args.locationId, year: args.year } },
    update: {
      ...args.values,
      updatedByUserId: args.actorUserId,
    },
    create: {
      locationId: args.locationId,
      year: args.year,
      ...args.values,
      updatedByUserId: args.actorUserId,
    },
    select: {
      id: true,
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
    },
  });

  if (hadChanges) {
    const action = existing ? "UPDATE_ENTRY" : "CREATE_ENTRY";
    await db.auditLog.create({
      data: {
        actorUserId: args.actorUserId,
        module: "PREVENTATIVE_MAINTENANCE",
        action,
        entityType: "PreventativeMaintenanceEntry",
        entityId: saved.id,
        message: `${action === "CREATE_ENTRY" ? "Created" : "Updated"} PM entry for ${location.name} (${args.year}).`,
        metadata: {
          source: args.source,
          locationId: args.locationId,
          locationName: location.name,
          year: args.year,
          changes,
          values: {
            ovenCleaning: saved.ovenCleaning,
            exhaustFanMotor: saved.exhaustFanMotor,
            tanklessWaterHeater: saved.tanklessWaterHeater,
            iceMaker: saved.iceMaker,
            greaseTrapGallons: saved.greaseTrapGallons,
          },
        },
      },
    });
  }

  return { saved, hadChanges };
}

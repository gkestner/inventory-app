import { prisma } from "@/app/lib/prisma";

export type PreventativeMaintenanceFieldKey =
  | "ovenCleaning"
  | "exhaustFanMotor"
  | "tanklessWaterHeater"
  | "iceMaker"
  | "greaseTrapGallons"
  | "greaseTrapTankSize"
  | "greaseTrapDatePumped"
  | "greaseTrapReminderMonths"
  | "greaseTrapCompany"
  | "greaseTrapCost"
  | "backflowDateChecked"
  | "backflowReminderMonths"
  | "backflowCompany"
  | "backflowAmount"
  | "boilerInspectionDatePrimary"
  | "boilerInspectionReminderMonths"
  | "boilerInspectionCompany"
  | "boilerInspectionCost"
  | "boilerInspectionDateSecondary";

export const PM_CHECKLIST_FIELDS: Array<{ key: PreventativeMaintenanceFieldKey; label: string }> = [
  { key: "ovenCleaning", label: "Oven Cleaning" },
  { key: "exhaustFanMotor", label: "Exhaust Fan Motor" },
  { key: "tanklessWaterHeater", label: "Tankless Water Heater" },
  { key: "iceMaker", label: "Ice Maker" },
  { key: "greaseTrapGallons", label: "(Gallons) Grease Trap" },
];

export const GREASE_TRAP_TRACKING_FIELDS: Array<{ key: PreventativeMaintenanceFieldKey; label: string }> = [
  { key: "greaseTrapTankSize", label: "Gal. Tank" },
  { key: "greaseTrapDatePumped", label: "Date Pumped" },
  { key: "greaseTrapReminderMonths", label: "Reminder (Months)" },
  { key: "greaseTrapCompany", label: "Company" },
  { key: "greaseTrapCost", label: "Cost" },
];

export const BACKFLOW_TRACKING_FIELDS: Array<{ key: PreventativeMaintenanceFieldKey; label: string }> = [
  { key: "backflowDateChecked", label: "Date Checked" },
  { key: "backflowReminderMonths", label: "Reminder (Months)" },
  { key: "backflowCompany", label: "Company" },
  { key: "backflowAmount", label: "Amount" },
];

export const BOILER_TRACKING_FIELDS: Array<{ key: PreventativeMaintenanceFieldKey; label: string }> = [
  { key: "boilerInspectionDatePrimary", label: "Date Inspected" },
  { key: "boilerInspectionReminderMonths", label: "Reminder (Months)" },
  { key: "boilerInspectionCost", label: "Cost" },
  { key: "boilerInspectionCompany", label: "Company" },
];

export const PREVENTATIVE_MAINTENANCE_FIELDS = PM_CHECKLIST_FIELDS;

export const PREVENTATIVE_MAINTENANCE_SECTIONS: Array<{
  id: "checklist" | "grease-trap" | "backflow" | "boiler";
  title: string;
  fields: Array<{ key: PreventativeMaintenanceFieldKey; label: string }>;
}> = [
  { id: "checklist", title: "General PM Checklist", fields: PM_CHECKLIST_FIELDS },
  { id: "grease-trap", title: "Grease Trap Tracking", fields: GREASE_TRAP_TRACKING_FIELDS },
  { id: "backflow", title: "Backflow Preventer Testing", fields: BACKFLOW_TRACKING_FIELDS },
  { id: "boiler", title: "Boiler Inspection Tracking", fields: BOILER_TRACKING_FIELDS },
];

export const PREVENTATIVE_MAINTENANCE_MAIN_SECTIONS = PREVENTATIVE_MAINTENANCE_SECTIONS.filter(
  (s) => s.id === "checklist"
);

export const PREVENTATIVE_MAINTENANCE_COMPLIANCE_SECTIONS = PREVENTATIVE_MAINTENANCE_SECTIONS.filter(
  (s) => s.id === "grease-trap" || s.id === "backflow" || s.id === "boiler"
);

const ALL_FIELDS = PREVENTATIVE_MAINTENANCE_SECTIONS.flatMap((s) => s.fields);

export const PREVENTATIVE_MAINTENANCE_FIELD_LABELS: Record<PreventativeMaintenanceFieldKey, string> =
  ALL_FIELDS.reduce(
    (acc, field) => {
      acc[field.key] = field.label;
      return acc;
    },
    {} as Record<PreventativeMaintenanceFieldKey, string>
  );

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
  greaseTrapTankSize: string;
  greaseTrapDatePumped: string;
  greaseTrapReminderMonths: string;
  greaseTrapCompany: string;
  greaseTrapCost: string;
  backflowDateChecked: string;
  backflowReminderMonths: string;
  backflowCompany: string;
  backflowAmount: string;
  boilerInspectionDatePrimary: string;
  boilerInspectionReminderMonths: string;
  boilerInspectionCompany: string;
  boilerInspectionCost: string;
  boilerInspectionDateSecondary: string;
};

type PreventativeMaintenancePersistedValues = {
  ovenCleaning: string | null;
  exhaustFanMotor: string | null;
  tanklessWaterHeater: string | null;
  iceMaker: string | null;
  greaseTrapGallons: string | null;
  greaseTrapTankSize: string | null;
  greaseTrapDatePumped: string | null;
  greaseTrapReminderMonths: string | null;
  greaseTrapCompany: string | null;
  greaseTrapCost: string | null;
  backflowDateChecked: string | null;
  backflowReminderMonths: string | null;
  backflowCompany: string | null;
  backflowAmount: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionReminderMonths: string | null;
  boilerInspectionCompany: string | null;
  boilerInspectionCost: string | null;
  boilerInspectionDateSecondary: string | null;
};

const EMPTY_VALUES: PreventativeMaintenanceValues = {
  ovenCleaning: "",
  exhaustFanMotor: "",
  tanklessWaterHeater: "",
  iceMaker: "",
  greaseTrapGallons: "",
  greaseTrapTankSize: "",
  greaseTrapDatePumped: "",
  greaseTrapReminderMonths: "",
  greaseTrapCompany: "",
  greaseTrapCost: "",
  backflowDateChecked: "",
  backflowReminderMonths: "",
  backflowCompany: "",
  backflowAmount: "",
  boilerInspectionDatePrimary: "",
  boilerInspectionReminderMonths: "",
  boilerInspectionCompany: "",
  boilerInspectionCost: "",
  boilerInspectionDateSecondary: "",
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
  for (const field of ALL_FIELDS) {
    const key = field.key;
    const from = normalizePersisted(before?.[key]);
    const to = normalizePersisted(after[key]);
    if (from === to) continue;
    changes[key] = { from, to };
  }
  return changes;
}

function mergeIncomingValues(
  before: PreventativeMaintenancePersistedValues | null,
  incoming: Partial<PreventativeMaintenanceValues>
): PreventativeMaintenanceValues {
  const merged: PreventativeMaintenanceValues = { ...EMPTY_VALUES };
  for (const field of ALL_FIELDS) {
    const key = field.key;
    const next = incoming[key];
    if (typeof next === "string") {
      merged[key] = next.trim();
      continue;
    }
    merged[key] = normalizePersisted(before?.[key]);
  }
  return merged;
}

export async function savePreventativeMaintenanceEntryWithAudit(args: {
  locationId: string;
  year: number;
  values: Partial<PreventativeMaintenanceValues>;
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
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapReminderMonths: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowReminderMonths: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionReminderMonths: true,
      boilerInspectionCompany: true,
      boilerInspectionCost: true,
      boilerInspectionDateSecondary: true,
    },
  });

  const mergedValues = mergeIncomingValues(existing, args.values);
  const changes = collectChanges(existing, mergedValues);
  const hadChanges = Object.keys(changes).length > 0 || !existing;

  const saved = await db.preventativeMaintenanceEntry.upsert({
    where: { locationId_year: { locationId: args.locationId, year: args.year } },
    update: {
      ...mergedValues,
      updatedByUserId: args.actorUserId,
    },
    create: {
      locationId: args.locationId,
      year: args.year,
      ...mergedValues,
      updatedByUserId: args.actorUserId,
    },
    select: {
      id: true,
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapReminderMonths: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowReminderMonths: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionReminderMonths: true,
      boilerInspectionCompany: true,
      boilerInspectionCost: true,
      boilerInspectionDateSecondary: true,
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
            greaseTrapTankSize: saved.greaseTrapTankSize,
            greaseTrapDatePumped: saved.greaseTrapDatePumped,
            greaseTrapReminderMonths: saved.greaseTrapReminderMonths,
            greaseTrapCompany: saved.greaseTrapCompany,
            greaseTrapCost: saved.greaseTrapCost,
            backflowDateChecked: saved.backflowDateChecked,
            backflowReminderMonths: saved.backflowReminderMonths,
            backflowCompany: saved.backflowCompany,
            backflowAmount: saved.backflowAmount,
            boilerInspectionDatePrimary: saved.boilerInspectionDatePrimary,
            boilerInspectionReminderMonths: saved.boilerInspectionReminderMonths,
            boilerInspectionCompany: saved.boilerInspectionCompany,
            boilerInspectionCost: saved.boilerInspectionCost,
            boilerInspectionDateSecondary: saved.boilerInspectionDateSecondary,
          },
        },
      },
    });
  }

  return { saved, hadChanges };
}

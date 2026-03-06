import { prisma } from "@/app/lib/prisma";

import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

export type EquipmentTrackingFieldKey =
  | "ngOrLp"
  | "iceCream"
  | "greaseTrapSize"
  | "modelNumber"
  | "serialNumber"
  | "manufacturer"
  | "color"
  | "freonType"
  | "notes"
  | "pepsiMachineOrBin"
  | "tanklessOrTank"
  | "condenserUnitNumber"
  | "evaporatorUnitNumber"
  | "tonnage"
  | "size"
  | "freezerType"
  | "letterSize"
  | "signType"
  | "amountOfHeads"
  | "cameraCount"
  | "lpOrNg";

export type EquipmentSectionKey =
  | "hot-bar"
  | "salad-bar"
  | "water-heater"
  | "ice-maker"
  | "make-table"
  | "freezer-1"
  | "freezer-2"
  | "sandwich-station"
  | "hvac-unit-1"
  | "hvac-unit-2"
  | "hvac-unit-3"
  | "walk-in"
  | "dough-roller"
  | "mixer"
  | "oven-top"
  | "oven-bottom"
  | "reader-board-4x8"
  | "pepe-sign"
  | "can-letter-sign"
  | "ice-cream-machine";

export type EquipmentSectionDefinition = {
  key: EquipmentSectionKey;
  title: string;
  fields: Array<{ key: EquipmentTrackingFieldKey; label: string }>;
};

const BASE_FIELDS: Array<{ key: EquipmentTrackingFieldKey; label: string }> = [
  { key: "ngOrLp", label: "NG or LP" },
  { key: "iceCream", label: "Ice Cream" },
];

function withBase(fields: Array<{ key: EquipmentTrackingFieldKey; label: string }>) {
  return [...BASE_FIELDS, ...fields];
}

export const EQUIPMENT_SECTIONS: EquipmentSectionDefinition[] = [
  {
    key: "hot-bar",
    title: "Hot Bar",
    fields: withBase([
      { key: "greaseTrapSize", label: "Grease Trap Size (Gallons)" },
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "color", label: "Color" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "salad-bar",
    title: "Salad Bar",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "color", label: "Color" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "water-heater",
    title: "Water Heater",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "tanklessOrTank", label: "Tankless or Tank" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "ice-maker",
    title: "Ice Maker",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "pepsiMachineOrBin", label: "Pepsi Machine or Bin" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "make-table",
    title: "Make Table",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "freezer-1",
    title: "Freezer 1",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "freezerType", label: "Type of Freezer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "freezer-2",
    title: "Freezer 2",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "freezerType", label: "Type of Freezer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "sandwich-station",
    title: "Sandwich Station",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "hvac-unit-1",
    title: "HVAC Unit 1",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "tonnage", label: "Tonnage" },
      { key: "freonType", label: "Freon Type" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "hvac-unit-2",
    title: "HVAC Unit 2",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "tonnage", label: "Tonnage" },
      { key: "freonType", label: "Freon Type" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "hvac-unit-3",
    title: "HVAC Unit 3",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "tonnage", label: "Tonnage" },
      { key: "freonType", label: "Freon Type" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "walk-in",
    title: "Walk-in",
    fields: withBase([
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "tonnage", label: "Tonnage" },
      { key: "size", label: "Size" },
      { key: "condenserUnitNumber", label: "Condenser Unit #" },
      { key: "evaporatorUnitNumber", label: "Evaporator Unit #" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "dough-roller",
    title: "Dough Roller",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "mixer",
    title: "Mixer",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "oven-top",
    title: "Oven #1 (Top)",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "oven-bottom",
    title: "Oven #2 (Bottom)",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "lpOrNg", label: "LP or NG" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "reader-board-4x8",
    title: "Reader Board 4x8",
    fields: withBase([
      { key: "letterSize", label: "Letter Size" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "pepe-sign",
    title: "Pepe Sign",
    fields: withBase([
      { key: "signType", label: "2x2 or 3x3" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "can-letter-sign",
    title: "Can Letter Sign",
    fields: withBase([
      { key: "size", label: "Size" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "notes", label: "Notes" },
    ]),
  },
  {
    key: "ice-cream-machine",
    title: "Ice Cream Machine",
    fields: withBase([
      { key: "modelNumber", label: "Model #" },
      { key: "serialNumber", label: "Serial #" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "freonType", label: "Freon Type" },
      { key: "amountOfHeads", label: "Amount of Heads" },
      { key: "notes", label: "Notes" },
    ]),
  },
];

export type EquipmentTrackingValues = Record<EquipmentTrackingFieldKey, string>;

const ALL_FIELDS = EQUIPMENT_SECTIONS.flatMap((s) => s.fields).map((f) => f.key);

export const EQUIPMENT_TRACKING_FIELD_KEYS = Array.from(new Set(ALL_FIELDS)) as EquipmentTrackingFieldKey[];

const EMPTY_VALUES: EquipmentTrackingValues = {
  ngOrLp: "",
  iceCream: "",
  greaseTrapSize: "",
  modelNumber: "",
  serialNumber: "",
  manufacturer: "",
  color: "",
  freonType: "",
  notes: "",
  pepsiMachineOrBin: "",
  tanklessOrTank: "",
  condenserUnitNumber: "",
  evaporatorUnitNumber: "",
  tonnage: "",
  size: "",
  freezerType: "",
  letterSize: "",
  signType: "",
  amountOfHeads: "",
  cameraCount: "",
  lpOrNg: "",
};

type EquipmentPersisted = {
  id: string;
  locationId: string;
  sectionKey: EquipmentSectionKey;
  ngOrLp: string | null;
  iceCream: string | null;
  greaseTrapSize: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  color: string | null;
  freonType: string | null;
  notes: string | null;
  pepsiMachineOrBin: string | null;
  tanklessOrTank: string | null;
  condenserUnitNumber: string | null;
  evaporatorUnitNumber: string | null;
  tonnage: string | null;
  size: string | null;
  freezerType: string | null;
  letterSize: string | null;
  signType: string | null;
  amountOfHeads: string | null;
  cameraCount: string | null;
  lpOrNg: string | null;
};

type Db = {
  location: {
    findUnique: (args: unknown) => Promise<{ id: string; name: string } | null>;
  };
  equipmentTrackingLog: {
    findUnique: (args: unknown) => Promise<EquipmentPersisted | null>;
    upsert: (args: unknown) => Promise<EquipmentPersisted>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function normalize(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function mergeValues(existing: EquipmentPersisted | null, incoming: Partial<EquipmentTrackingValues>) {
  const merged: EquipmentTrackingValues = { ...EMPTY_VALUES };
  for (const key of ALL_FIELDS) {
    const next = incoming[key];
    if (typeof next === "string") {
      merged[key] = next.trim();
    } else {
      merged[key] = normalize(existing?.[key]);
    }
  }
  return merged;
}

function collectChanges(existing: EquipmentPersisted | null, merged: EquipmentTrackingValues) {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const key of ALL_FIELDS) {
    const from = normalize(existing?.[key]);
    const to = normalize(merged[key]);
    if (from === to) continue;
    changes[key] = { from, to };
  }
  return changes;
}

export function parseEquipmentTrackingValues(formData: FormData): Partial<EquipmentTrackingValues> {
  const out: Partial<EquipmentTrackingValues> = {};
  for (const key of ALL_FIELDS) {
    if (!formData.has(key)) continue;
    const raw = formData.get(key);
    out[key] = typeof raw === "string" ? raw.trim() : "";
  }
  return out;
}

export async function getMaintenanceEquipmentLocationsForUser(userId: string) {
  const assignments = await loadMaintenancePrimaryAssignments();
  const unique = new Map<string, { id: string; name: string }>();
  for (const a of assignments) {
    if (a.userId !== userId) continue;
    if (unique.has(a.locationId)) continue;
    unique.set(a.locationId, { id: a.locationId, name: a.locationName });
  }
  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveEquipmentTrackingWithAudit(args: {
  locationId: string;
  sectionKey: EquipmentSectionKey;
  values: Partial<EquipmentTrackingValues>;
  actorUserId: string;
  source: "MAINTENANCE" | "ADMIN";
}) {
  const location = await db.location.findUnique({
    where: { id: args.locationId },
    select: { id: true, name: true },
  });
  if (!location) throw new Error("Invalid location.");

  const existing = await db.equipmentTrackingLog.findUnique({
    where: { locationId_sectionKey: { locationId: args.locationId, sectionKey: args.sectionKey } },
    select: {
      id: true,
      locationId: true,
      sectionKey: true,
      ngOrLp: true,
      iceCream: true,
      greaseTrapSize: true,
      modelNumber: true,
      serialNumber: true,
      manufacturer: true,
      color: true,
      freonType: true,
      notes: true,
      pepsiMachineOrBin: true,
      tanklessOrTank: true,
      condenserUnitNumber: true,
      evaporatorUnitNumber: true,
      tonnage: true,
      size: true,
      freezerType: true,
      letterSize: true,
      signType: true,
      amountOfHeads: true,
      cameraCount: true,
      lpOrNg: true,
    },
  });

  const merged = mergeValues(existing, args.values);
  const changes = collectChanges(existing, merged);

  const saved = await db.equipmentTrackingLog.upsert({
    where: { locationId_sectionKey: { locationId: args.locationId, sectionKey: args.sectionKey } },
    update: {
      ...merged,
      updatedByUserId: args.actorUserId,
    },
    create: {
      locationId: args.locationId,
      sectionKey: args.sectionKey,
      ...merged,
      updatedByUserId: args.actorUserId,
    },
    select: {
      id: true,
      locationId: true,
      sectionKey: true,
      ngOrLp: true,
      iceCream: true,
      greaseTrapSize: true,
      modelNumber: true,
      serialNumber: true,
      manufacturer: true,
      color: true,
      freonType: true,
      notes: true,
      pepsiMachineOrBin: true,
      tanklessOrTank: true,
      condenserUnitNumber: true,
      evaporatorUnitNumber: true,
      tonnage: true,
      size: true,
      freezerType: true,
      letterSize: true,
      signType: true,
      amountOfHeads: true,
      cameraCount: true,
      lpOrNg: true,
    },
  });

  if (Object.keys(changes).length > 0 || !existing) {
    await db.auditLog.create({
      data: {
        actorUserId: args.actorUserId,
        module: "EQUIPMENT_TRACKING",
        action: existing ? "UPDATE_LOG" : "CREATE_LOG",
        entityType: "EquipmentTrackingLog",
        entityId: saved.id,
        message: `Updated equipment log (${args.sectionKey}) for ${location.name}.`,
        metadata: {
          source: args.source,
          locationId: args.locationId,
          locationName: location.name,
          sectionKey: args.sectionKey,
          changes,
        },
      },
    });
  }

  return saved;
}

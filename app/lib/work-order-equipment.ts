import { prisma } from "@/app/lib/prisma";
import { isSchemaOrDbNotReadyError } from "@/app/lib/prisma-schema-compat";

export const WORK_ORDER_EQUIPMENT_AREAS = [
  "DOUGH_ROLLER",
  "MAKETABLE",
  "DOUGH_COOLER",
  "MIXER",
  "OVEN",
  "WALK_IN",
  "FREEZER",
  "BUILDING_STRUCTURE",
  "GENERAL_BUILDING_MAINTENANCE",
  "GREASE_TRAPS",
  "EQUIPMENT_FILTERS",
  "LIGHTING",
  "PARKING_LOT",
  "OFFICE",
  "PLUMBING",
  "HVAC_GAME_ROOM",
  "HVAC_KITCHEN",
  "HVAC_DINING_ROOM",
  "OTHER",
] as const;

export const WORK_ORDER_LEGACY_EQUIPMENT_AREAS = ["FRONT_COUNTER", "DRIVE_THRU", "KITCHEN", "ROOF", "HVAC"] as const;

export type WorkOrderEquipmentArea = string;
export type WorkOrderLegacyEquipmentArea = (typeof WORK_ORDER_LEGACY_EQUIPMENT_AREAS)[number];
export type WorkOrderEquipmentAreaDb = WorkOrderEquipmentArea | WorkOrderLegacyEquipmentArea;

export type WorkOrderEquipmentCategoryRow = {
  key: string;
  label: string;
  sortOrder: number;
  active: boolean;
};

export type EquipmentAreaChecklistItemRow = {
  id: string;
  area: WorkOrderEquipmentArea;
  label: string;
  sortOrder: number;
  active: boolean;
};

export type WorkOrderChecklistSelectionRow = {
  workOrderId: string;
  checklistItemId: string;
  labelSnapshot: string;
  area: WorkOrderEquipmentArea;
};

type ChecklistItemDelegate = {
  findMany: (args: unknown) => Promise<EquipmentAreaChecklistItemRow[]>;
};

type CategoryDelegate = {
  findMany: (args: unknown) => Promise<WorkOrderEquipmentCategoryRow[]>;
};

type ChecklistSelectionDelegate = {
  findMany: (args: unknown) => Promise<WorkOrderChecklistSelectionRow[]>;
  deleteMany: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
};

type ChecklistDb = {
  workOrderEquipmentCategory?: CategoryDelegate;
  equipmentAreaChecklistItem: ChecklistItemDelegate;
  workOrderChecklistSelection: ChecklistSelectionDelegate;
};

export type WorkOrderChecklistTx = {
  equipmentAreaChecklistItem: Pick<ChecklistItemDelegate, "findMany">;
  workOrderChecklistSelection: Pick<ChecklistSelectionDelegate, "deleteMany" | "createMany">;
};

const db = prisma as unknown as ChecklistDb;

export const DEFAULT_WORK_ORDER_EQUIPMENT_CATEGORIES: WorkOrderEquipmentCategoryRow[] = WORK_ORDER_EQUIPMENT_AREAS.map(
  (key, index) => ({
    key,
    label: formatWorkOrderEquipmentAreaLabel(key),
    sortOrder: (index + 1) * 10,
    active: true,
  })
);

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function isWorkOrderEquipmentArea(value: string): value is WorkOrderEquipmentArea {
  return /^[A-Z0-9_]{2,80}$/.test(value);
}

export function isLegacyWorkOrderEquipmentArea(value: string): value is WorkOrderLegacyEquipmentArea {
  return (WORK_ORDER_LEGACY_EQUIPMENT_AREAS as readonly string[]).includes(value);
}

export function parseWorkOrderEquipmentAreas(formData: FormData): WorkOrderEquipmentArea[] {
  const raw = formData.getAll("areas");
  const out: WorkOrderEquipmentArea[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!isWorkOrderEquipmentArea(value)) continue;
    out.push(value);
  }

  return dedupeStrings(out) as WorkOrderEquipmentArea[];
}

export function parseChecklistItemIds(formData: FormData): string[] {
  return dedupeStrings(
    formData
      .getAll("checklistItemIds")
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
  );
}

export function formatWorkOrderEquipmentAreaLabel(area: string): string {
  if (area === "MAKETABLE") return "Make Table";
  const parts = area.split("_").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === "HVAC") {
      out.push("HVAC");
      continue;
    }
    if (upper === "DOUGH") {
      out.push("Dough");
      continue;
    }
    out.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }
  return out.join(" ");
}

export function formatWorkOrderEquipmentAreaLabelWithLegacy(area: WorkOrderEquipmentAreaDb): string {
  const label = formatWorkOrderEquipmentAreaLabel(area);
  return isLegacyWorkOrderEquipmentArea(area) ? `${label} (legacy)` : label;
}

export function buildWorkOrderEquipmentCategoryKey(label: string): string {
  const key = label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();

  if (!isWorkOrderEquipmentArea(key)) {
    throw new Error("Category name must include at least two letters or numbers.");
  }

  return key;
}

export async function listWorkOrderEquipmentCategories(args?: {
  includeInactive?: boolean;
}): Promise<WorkOrderEquipmentCategoryRow[]> {
  const includeInactive = args?.includeInactive ?? false;
  try {
    if (!db.workOrderEquipmentCategory) return DEFAULT_WORK_ORDER_EQUIPMENT_CATEGORIES;
    const rows = await db.workOrderEquipmentCategory.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        key: true,
        label: true,
        sortOrder: true,
        active: true,
      },
    } as unknown);

    return rows.length > 0 ? rows : DEFAULT_WORK_ORDER_EQUIPMENT_CATEGORIES;
  } catch (error) {
    if (isSchemaOrDbNotReadyError(error)) return DEFAULT_WORK_ORDER_EQUIPMENT_CATEGORIES;
    throw error;
  }
}

export async function listChecklistItems(args?: { includeInactive?: boolean }): Promise<EquipmentAreaChecklistItemRow[]> {
  const includeInactive = args?.includeInactive ?? false;
  try {
    return await db.equipmentAreaChecklistItem.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ area: "asc" }, { label: "asc" }],
      select: {
        id: true,
        area: true,
        label: true,
        sortOrder: true,
        active: true,
      },
    } as unknown);
  } catch (error) {
    if (isSchemaOrDbNotReadyError(error)) return [];
    throw error;
  }
}

export function groupChecklistItemsByArea(
  rows: EquipmentAreaChecklistItemRow[],
  categories: Array<{ key: string }> = DEFAULT_WORK_ORDER_EQUIPMENT_CATEGORIES
): Record<string, EquipmentAreaChecklistItemRow[]> {
  const grouped: Record<string, EquipmentAreaChecklistItemRow[]> = {};
  for (const category of categories) {
    grouped[category.key] = [];
  }

  for (const row of rows) {
    if (!isWorkOrderEquipmentArea(row.area)) continue;
    if (!grouped[row.area]) grouped[row.area] = [];
    grouped[row.area].push(row);
  }

  return grouped;
}

export async function listChecklistSelectionsForWorkOrders(workOrderIds: string[]): Promise<WorkOrderChecklistSelectionRow[]> {
  if (workOrderIds.length === 0) return [];

  try {
    return await db.workOrderChecklistSelection.findMany({
      where: { workOrderId: { in: workOrderIds } },
      orderBy: [{ workOrderId: "asc" }, { area: "asc" }, { labelSnapshot: "asc" }],
      select: {
        workOrderId: true,
        checklistItemId: true,
        labelSnapshot: true,
        area: true,
      },
    } as unknown);
  } catch (error) {
    if (isSchemaOrDbNotReadyError(error)) return [];
    throw error;
  }
}

export function groupChecklistSelectionsByWorkOrder(
  rows: WorkOrderChecklistSelectionRow[]
): Record<string, WorkOrderChecklistSelectionRow[]> {
  const grouped: Record<string, WorkOrderChecklistSelectionRow[]> = {};
  for (const row of rows) {
    if (!grouped[row.workOrderId]) grouped[row.workOrderId] = [];
    grouped[row.workOrderId].push(row);
  }
  return grouped;
}

export function buildChecklistItemIdSet(rows: Array<{ checklistItemId: string }>): Set<string> {
  return new Set(rows.map((row) => row.checklistItemId));
}

export function formatChecklistSelectionSummary(
  rows: Array<{ area: WorkOrderEquipmentArea; labelSnapshot: string }>
): string {
  if (rows.length === 0) return "";

  const grouped = new Map<WorkOrderEquipmentArea, string[]>();
  for (const row of rows) {
    const labels = grouped.get(row.area) ?? [];
    labels.push(row.labelSnapshot);
    grouped.set(row.area, labels);
  }

  return Array.from(grouped.entries())
    .map(([area, labels]) => `${formatWorkOrderEquipmentAreaLabel(area)}: ${labels.join(", ")}`)
    .join(" | ");
}

export async function syncWorkOrderChecklistSelections(
  tx: WorkOrderChecklistTx,
  args: { workOrderId: string; areas: WorkOrderEquipmentArea[]; checklistItemIds: string[] }
) {
  try {
    const itemIds = dedupeStrings(args.checklistItemIds);
    const areaSet = new Set(args.areas);
    const items = itemIds.length
      ? await tx.equipmentAreaChecklistItem.findMany({
          where: {
            id: { in: itemIds },
            active: true,
          },
          select: {
            id: true,
            area: true,
            label: true,
            sortOrder: true,
            active: true,
          },
        } as unknown)
      : [];

    const selected = items.filter((item) => areaSet.has(item.area));

    await tx.workOrderChecklistSelection.deleteMany({ where: { workOrderId: args.workOrderId } } as unknown);
    if (selected.length === 0) return;

    await tx.workOrderChecklistSelection.createMany({
      data: selected.map((item) => ({
        workOrderId: args.workOrderId,
        checklistItemId: item.id,
        labelSnapshot: item.label,
        area: item.area,
      })),
    } as unknown);
  } catch (error) {
    if (isSchemaOrDbNotReadyError(error)) return;
    throw error;
  }
}

// app/maintenance/work-orders/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { isSchemaOrDbNotReadyError } from "@/app/lib/prisma-schema-compat";
import { Permission, Role, WorkOrderPingEvent } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import WorkOrderEquipmentSelector from "@/app/components/WorkOrderEquipmentSelector";
import {
  WORK_ORDER_EQUIPMENT_AREAS,
  type WorkOrderChecklistTx,
  type WorkOrderEquipmentArea as SharedEquipmentArea,
  type WorkOrderEquipmentAreaDb,
  buildChecklistItemIdSet,
  formatChecklistSelectionSummary,
  formatWorkOrderEquipmentAreaLabel,
  formatWorkOrderEquipmentAreaLabelWithLegacy,
  groupChecklistItemsByArea,
  groupChecklistSelectionsByWorkOrder,
  isLegacyWorkOrderEquipmentArea,
  listChecklistItems,
  listChecklistSelectionsForWorkOrders,
  parseChecklistItemIds,
  parseWorkOrderEquipmentAreas,
  syncWorkOrderChecklistSelections,
} from "@/app/lib/work-order-equipment";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";
const CANONICAL_RETURN = "/work-orders";

type SessionShape = {
  user?: {
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type SearchParams = {
  err?: string;
};

function redirectToWorkOrders(err?: string): never {
  const params = new URLSearchParams();
  if (err) params.set("err", err);
  const qs = params.toString();
  redirect(qs ? `${CANONICAL_RETURN}?${qs}` : CANONICAL_RETURN);
}

function getCompleteWorkOrderErrorMessage(error: unknown, clearCarryover: boolean): string {
  if (isSchemaOrDbNotReadyError(error)) {
    return "Recent work order updates are still deploying. Try again in a minute.";
  }

  if (error instanceof Error) {
    switch (error.message) {
      case "Missing work order id":
        return "Missing work order id.";
      case "Ending mileage is required.":
      case "Notes are required when Equipment Area 'Other' is selected.":
        return error.message;
      case "Work order not found.":
        return "Work order not found.";
      case "Work order is already ended.":
        return "This work order was already ended. Refresh the page.";
      default:
        break;
    }
  }

  return clearCarryover ? "Failed to end the day. Please try again." : "Failed to end the work order. Please try again.";
}

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  const email = session.user?.email ?? null;
  if (!email) redirect("/login");
}

// ✅ No role bypass: permissions control access now.
function roleBypassesPermissions(_session: SessionShape): boolean {
  return false;
}

async function requireWorkOrdersView(session: SessionShape) {
  requireSession(session);
  if (roleBypassesPermissions(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  if (!ok) redirect("/maintenance");
}

async function requireWorkOrdersCreate(session: SessionShape) {
  requireSession(session);
  if (roleBypassesPermissions(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.CREATE_WORK_ORDERS]);
  if (!ok) redirect("/maintenance");
}

async function requireWorkOrdersSubmitOwn(session: SessionShape) {
  requireSession(session);
  if (roleBypassesPermissions(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.SUBMIT_OWN_WORK_ORDERS]);
  if (!ok) redirect("/maintenance");
}

/**
 * Edit own work orders requires UPDATE_OWN_WORK_ORDERS now.
 * Ownership is still enforced inside the server actions (createdByUserId === me.id).
 */
async function requireWorkOrdersUpdateOwn(session: SessionShape) {
  requireSession(session);
  if (roleBypassesPermissions(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.UPDATE_OWN_WORK_ORDERS]);
  if (!ok) redirect("/maintenance");
}

type WorkOrderStatus = "DRAFT" | "SUBMITTED" | "FINALIZED";
type EquipmentArea = SharedEquipmentArea;
type EquipmentAreaDb = WorkOrderEquipmentAreaDb;

type WorkOrdersMeRow = {
  id: string;
  active: boolean;
  role: Role | null;
  nextWorkOrderStartingMileage: number | null;
  locationId: string | null;
  location: { id: string; name: string; active: boolean; receiptEnabled: boolean } | null;
  allowedLocations: Array<{
    locationId: string;
    isPrimary: boolean;
    sortOrder: number;
    location: { id: string; name: string; active: boolean; receiptEnabled: boolean } | null;
  }>;
};

const EQUIPMENT_AREAS: readonly EquipmentArea[] = WORK_ORDER_EQUIPMENT_AREAS;

function isLegacyArea(a: EquipmentAreaDb): boolean {
  return isLegacyWorkOrderEquipmentArea(a);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseAreas(formData: FormData): EquipmentArea[] {
  return parseWorkOrderEquipmentAreas(formData);
}

function requireNotesWhenOtherAreaSelected(areas: EquipmentArea[], notes: string) {
  if (!areas.includes("OTHER")) return;
  if (notes.trim().length > 0) return;
  throw new Error("Notes are required when Equipment Area 'Other' is selected.");
}

function parseOptionalInt(v: FormDataEntryValue | null): number | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseRequiredInt(v: FormDataEntryValue | null, message: string): number {
  const n = parseOptionalInt(v);
  if (n === null) throw new Error(message);
  return n;
}

function parseOptionalDateTimeLocal(v: FormDataEntryValue | null): Date | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtForDatetimeLocal(d: Date | null): string {
  if (!d) return "";
  const x = new Date(d);
  const y = x.getFullYear();
  const mo = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  const h = String(x.getHours()).padStart(2, "0");
  const mi = String(x.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(d));
}

function formatAreaLabel(area: string): string {
  return formatWorkOrderEquipmentAreaLabel(area);
}

function formatAreaLabelWithLegacy(area: EquipmentAreaDb): string {
  return formatWorkOrderEquipmentAreaLabelWithLegacy(area);
}

function statusLabel(s: WorkOrderStatus): string {
  if (s === "DRAFT") return "IN PROGRESS";
  if (s === "SUBMITTED") return "PENDING";
  if (s === "FINALIZED") return "ARCHIVED";
  return s;
}

async function findWorkOrdersMe(email: string): Promise<WorkOrdersMeRow | null> {
  const baseSelect = {
    id: true,
    active: true,
    role: true,
    locationId: true,
    location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
    allowedLocations: {
      orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }, { location: { name: "asc" as const } }],
      select: {
        locationId: true,
        isPrimary: true,
        sortOrder: true,
        location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
      },
    },
  };

  try {
    return (await prisma.user.findUnique({
      where: { email },
      select: {
        ...baseSelect,
        nextWorkOrderStartingMileage: true,
      },
    })) as WorkOrdersMeRow | null;
  } catch (error) {
    if (!isSchemaOrDbNotReadyError(error)) throw error;

    const fallback = await prisma.user.findUnique({ where: { email }, select: baseSelect });
    if (!fallback) return null;
    return { ...fallback, nextWorkOrderStartingMileage: null };
  }
}

export default async function MaintenanceWorkOrdersPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  await requireWorkOrdersView(session);

  const sp = (await searchParams) ?? {};
  const err = String(sp.err ?? "").trim();

  const email = (session?.user?.email ?? "").toLowerCase().trim();

  const perms = await loadUserPermissions(session);
  const allowAll = !!perms.allowAll;
  const bypass = roleBypassesPermissions(session);

  const canCreate = bypass || allowAll || hasAnyPermission(perms, [Permission.CREATE_WORK_ORDERS]);
  const canSubmitOwn = bypass || allowAll || hasAnyPermission(perms, [Permission.SUBMIT_OWN_WORK_ORDERS]);
  const canUpdateOwn = bypass || allowAll || hasAnyPermission(perms, [Permission.UPDATE_OWN_WORK_ORDERS]);

  const me = await findWorkOrdersMe(email);

  if (!me || !me.active) redirect("/login");

  const allowedLocations: Array<{ id: string; name: string; source: "PRIMARY" | "OPTIONAL" }> = [];
  const seen = new Set<string>();

  if (me.location?.active && me.location.receiptEnabled) {
    seen.add(me.location.id);
    allowedLocations.push({ id: me.location.id, name: me.location.name, source: "PRIMARY" });
  }

  for (const ul of me.allowedLocations) {
    if (!ul.location) continue;
    if (!ul.location.active || !ul.location.receiptEnabled) continue;
    if (seen.has(ul.location.id)) continue;
    seen.add(ul.location.id);
    allowedLocations.push({ id: ul.location.id, name: ul.location.name, source: ul.isPrimary ? "PRIMARY" : "OPTIONAL" });
  }

  const inProgress = await prisma.workOrder.findFirst({
    where: {
      createdByUserId: me.id,
      status: "DRAFT",
      endTime: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      workOrderNumber: true,
      createdAt: true,
      locationId: true,
      location: { select: { name: true } },
      notes: true,
      startTime: true,
      startingMileage: true,
      endingMileage: true,
      equipmentAreas: { select: { area: true } },
    },
  });

  const workOrders = await prisma.workOrder.findMany({
    where: { createdByUserId: me.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      status: true,
      workOrderNumber: true,
      createdAt: true,
      locationId: true,
      location: { select: { name: true } },
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      notes: true,
      equipmentAreas: { select: { area: true } },
    },
  });

  const workOrderIds = Array.from(new Set([...(inProgress ? [inProgress.id] : []), ...workOrders.map((wo) => wo.id)]));
  const [checklistItems, checklistSelections] = await Promise.all([
    listChecklistItems(),
    listChecklistSelectionsForWorkOrders(workOrderIds),
  ]);
  const checklistItemsByArea = groupChecklistItemsByArea(checklistItems);
  const checklistSelectionsByWorkOrder = groupChecklistSelectionsByWorkOrder(checklistSelections);

  const CONTENT_WIDTH = 1100;
  const BASE_FONT = 16;
  const LABEL_FONT = 14;
  const CONTROL_FONT = 16;
  const BUTTON_FONT = 16;
  const CONTROL_H = 46;
  const BUTTON_H = 50;

  const shell: CSSProperties = {
    padding: 22,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    fontSize: BASE_FONT,
  };

  const pageWidth: CSSProperties = {
    width: "100%",
    maxWidth: CONTENT_WIDTH,
  };

  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 14,
    padding: 14,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const label: CSSProperties = { display: "grid", gap: 6, fontSize: LABEL_FONT, opacity: 0.95, fontWeight: 800 };

  const input: CSSProperties = {
    height: CONTROL_H,
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
    fontSize: CONTROL_FONT,
  };

  const textareaBase: CSSProperties = {
    ...input,
    height: "auto",
    minHeight: 96,
    lineHeight: 1.35,
  };

  const btn: CSSProperties = {
    height: BUTTON_H,
    padding: "0 18px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: BUTTON_FONT,
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const btnStartTime: CSSProperties = {
    ...btn,
    background: "rgba(0, 180, 90, 0.22)",
    border: "1px solid rgba(0, 180, 90, 0.55)",
    boxShadow: "0 0 0 1px rgba(0, 180, 90, 0.18) inset",
  };

  const btnEndTime: CSSProperties = {
    ...btn,
    background: "rgba(220, 60, 60, 0.22)",
    border: "1px solid rgba(220, 60, 60, 0.55)",
    boxShadow: "0 0 0 1px rgba(220, 60, 60, 0.18) inset",
  };

  const btnSaveEdit: CSSProperties = {
    ...btn,
    height: 46,
    background: "rgba(80, 160, 255, 0.18)",
    border: "1px solid rgba(80, 160, 255, 0.45)",
    boxShadow: "0 0 0 1px rgba(80, 160, 255, 0.12) inset",
  };

  const btnPictures: CSSProperties = {
    ...btn,
    height: 44,
    background: "rgba(59, 130, 246, 0.2)",
    border: "1px solid rgba(59, 130, 246, 0.55)",
    boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.14) inset",
    textDecoration: "none",
  };

  const photoTargetId = inProgress?.id ?? workOrders[0]?.id ?? null;
  const suggestedStartingMileage = me.nextWorkOrderStartingMileage;
  const isFirstWorkOrderOfDay = suggestedStartingMileage === null;

  const gridWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    marginTop: 10,
  };

  const gridItem: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 800,
    background: "rgba(255,255,255,0.03)",
  };

  const checkboxStyle: CSSProperties = {
    width: 18,
    height: 18,
  };

  async function startWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireWorkOrdersCreate(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        location: { select: { id: true, active: true, receiptEnabled: true } },
        allowedLocations: {
          select: { locationId: true, location: { select: { active: true, receiptEnabled: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!me || !me.active) redirect("/login");

    const existing = await prisma.workOrder.findFirst({
      where: { createdByUserId: me.id, status: "DRAFT", endTime: null },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) redirect(CANONICAL_RETURN);

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required");

    const allowed = new Set<string>();
    if (me.locationId && me.location?.active && me.location.receiptEnabled) allowed.add(me.locationId);
    for (const ul of me.allowedLocations) {
      if (ul.location?.active && ul.location.receiptEnabled) allowed.add(ul.locationId);
    }
    if (!allowed.has(locationId)) throw new Error("You are not allowed to create a work order for that location.");

    const notes = String(formData.get("notes") ?? "");
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const areas = parseAreas(formData);
    const checklistItemIds = parseChecklistItemIds(formData);

    requireNotesWhenOtherAreaSelected(areas, notes);

    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          locationId,
          status: "DRAFT",
          notes,
          startingMileage,
          startTime: new Date(),
          createdByUserId: me.id,
        },
        select: { id: true },
      });

      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: wo.id, area })),
        });
      }

      await syncWorkOrderChecklistSelections(tx as unknown as WorkOrderChecklistTx, {
        workOrderId: wo.id,
        areas,
        checklistItemIds,
      });

      await tx.workOrderPing.create({
        data: {
          workOrderId: wo.id,
          locationId,
          actorUserId: me.id,
          event: WorkOrderPingEvent.STARTED,
          note: "Work order started.",
        },
      });
    });

    revalidatePath("/work-orders");
    revalidatePath("/maintenance/work-orders");
    redirect(CANONICAL_RETURN);
  }

  async function endWorkOrderAction(formData: FormData) {
    "use server";

    await completeWorkOrderAction(formData, { clearCarryover: false });
  }

  async function endDayAction(formData: FormData) {
    "use server";

    await completeWorkOrderAction(formData, { clearCarryover: true });
  }

  async function completeWorkOrderAction(formData: FormData, options: { clearCarryover: boolean }) {
    const { clearCarryover } = options;

    try {
      const session = (await getServerSession(authOptions)) as SessionShape;
      await requireWorkOrdersSubmitOwn(session);

      const email = (session?.user?.email ?? "").toLowerCase().trim();
      const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
      if (!me || !me.active) redirect("/login");

      const id = String(formData.get("id") ?? "").trim();
      if (!id) throw new Error("Missing work order id");

      const endingMileage = parseRequiredInt(formData.get("endingMileage"), "Ending mileage is required.");
      const nextWorkOrderStartingMileage = clearCarryover ? null : endingMileage;
      const notes = String(formData.get("notes") ?? "");
      const areas = parseAreas(formData);
      const checklistItemIds = parseChecklistItemIds(formData);

      requireNotesWhenOtherAreaSelected(areas, notes);

      await prisma.$transaction(async (tx) => {
        const wo = await tx.workOrder.findUnique({
          where: { id },
          select: { id: true, locationId: true, createdByUserId: true, status: true, endTime: true },
        });
        if (!wo || wo.createdByUserId !== me.id) throw new Error("Work order not found.");
        if (wo.status !== "DRAFT" || wo.endTime !== null) throw new Error("Work order is already ended.");

        await tx.workOrder.update({
          where: { id },
          data: {
            endTime: new Date(),
            endingMileage,
            notes,
            status: "SUBMITTED",
          },
        });

        await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
        if (areas.length > 0) {
          await tx.workOrderEquipmentArea.createMany({
            data: areas.map((area) => ({ workOrderId: id, area })),
          });
        }

        await syncWorkOrderChecklistSelections(tx as unknown as WorkOrderChecklistTx, {
          workOrderId: id,
          areas,
          checklistItemIds,
        });

        await tx.workOrderPing.create({
          data: {
            workOrderId: id,
            locationId: wo.locationId,
            actorUserId: me.id,
            event: WorkOrderPingEvent.STOPPED,
            note: clearCarryover ? "Work day ended." : "Work order stopped.",
          },
        });

        try {
          await tx.user.update({
            where: { id: me.id },
            data: { nextWorkOrderStartingMileage },
          });
        } catch (error) {
          if (!isSchemaOrDbNotReadyError(error)) throw error;
        }
      });

      revalidatePath("/work-orders");
      revalidatePath("/maintenance/work-orders");
      redirect(CANONICAL_RETURN);
    } catch (error) {
      unstable_rethrow(error);
      console.error("completeWorkOrderAction failed:", error);
      redirectToWorkOrders(getCompleteWorkOrderErrorMessage(error, clearCarryover));
    }
  }

  async function updateWorkOrderFromListAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireWorkOrdersUpdateOwn(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required.");

    const notes = String(formData.get("notes") ?? "");
    const startTime = parseOptionalDateTimeLocal(formData.get("startTime"));
    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));
    const areas = parseAreas(formData);
    const checklistItemIds = parseChecklistItemIds(formData);

    requireNotesWhenOtherAreaSelected(areas, notes);

    const allowedLocationIds = new Set<string>(allowedLocations.map((l) => l.id));
    if (!allowedLocationIds.has(locationId)) {
      throw new Error("Invalid location selection.");
    }

    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUnique({
        where: { id },
        select: { id: true, createdByUserId: true, status: true, endTime: true },
      });

      if (!wo || wo.createdByUserId !== me.id) throw new Error("Work order not found.");
      if (wo.status !== "DRAFT" && wo.status !== "SUBMITTED") {
        throw new Error("Only IN PROGRESS or PENDING work orders can be edited here.");
      }

      // Keep pending work orders complete.
      if (wo.status === "SUBMITTED") {
        if (!endTime) throw new Error("Pending work orders require End Time.");
        if (endingMileage === null) throw new Error("Pending work orders require Ending Mileage.");
      }

      await tx.workOrder.update({
        where: { id },
        data: {
          locationId,
          notes,
          startTime,
          endTime,
          startingMileage,
          endingMileage,
        },
      });

      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: id, area })),
        });
      }

      await syncWorkOrderChecklistSelections(tx as unknown as WorkOrderChecklistTx, {
        workOrderId: id,
        areas,
        checklistItemIds,
      });

      await tx.workOrderPing.create({
        data: {
          workOrderId: id,
          locationId,
          actorUserId: me.id,
          event: WorkOrderPingEvent.EDITED,
          note: "Work order details edited.",
        },
      });
    });

    revalidatePath("/work-orders");
    revalidatePath("/maintenance/work-orders");
    redirect(CANONICAL_RETURN);
  }

  const inProgressChecked = new Set<string>(inProgress?.equipmentAreas?.map((x) => String(x.area)) ?? []);

  return (
    <main>
      <div style={shell}>
        <div style={pageWidth}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Maintenance: Work Orders</h1>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            Times displayed in <b>{TZ}</b>.
          </div>

          {!canCreate ? (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              You can view work orders, but you don’t have permission to start new ones.
            </div>
          ) : null}

          {!canSubmitOwn ? (
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
              You can view/create, but you don’t have permission to end/submit your work orders.
            </div>
          ) : null}

          {!canUpdateOwn ? (
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
              You don’t have permission to edit your work orders.
            </div>
          ) : null}

          {err ? (
            <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(220,60,60,0.35)", borderRadius: 10 }}>
              {err}
            </div>
          ) : null}
        </div>

        {/* TOP CARD: Start OR End */}
        <div style={{ ...card, ...pageWidth, marginTop: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Photos are uploaded from a specific work order detail screen.</div>
            {photoTargetId ? (
              <a href={`/maintenance/work-orders/${photoTargetId}`} style={btnPictures}>
                Add Pictures
              </a>
            ) : (
              <button type="button" style={{ ...btnPictures, opacity: 0.55, cursor: "not-allowed" }} disabled>
                Add Pictures
              </button>
            )}
          </div>

          {!inProgress ? (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>{isFirstWorkOrderOfDay ? "Start Day" : "Start Work Order"}</h2>

              {!canCreate ? (
                <div style={{ fontSize: 14, opacity: 0.85 }}>You don’t have permission to start a work order.</div>
              ) : allowedLocations.length === 0 ? (
                <div style={{ fontSize: 14, opacity: 0.85 }}>
                  You don’t have any locations assigned yet. Ask an admin to assign your primary/optional locations.
                </div>
              ) : (
                <form action={startWorkOrderAction} style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={label}>
                      Location
                      <select name="locationId" defaultValue={allowedLocations[0]?.id ?? ""} style={input} required>
                        {allowedLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                            {l.source === "PRIMARY" ? " (Primary)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={label}>
                      Starting Mileage {suggestedStartingMileage === null ? "(optional)" : "(editable carryover)"}
                      <input
                        name="startingMileage"
                        type="number"
                        defaultValue={suggestedStartingMileage ?? ""}
                        placeholder="e.g. 12345"
                        style={input}
                      />
                    </label>
                  </div>

                  {suggestedStartingMileage !== null ? (
                    <div style={{ fontSize: 13, opacity: 0.82 }}>
                      Starting mileage was carried over from your previous work order and can be changed before starting.
                    </div>
                  ) : null}

                  <label style={label}>
                    Notes (optional, required if Other is selected)
                    <textarea name="notes" placeholder="Short description (optional)..." style={textareaBase} />
                  </label>

                  <div>
                    <WorkOrderEquipmentSelector
                      title="Equipment Areas (optional)"
                      templatesByArea={checklistItemsByArea}
                      checkboxStyle={checkboxStyle}
                      gridWrapStyle={gridWrap}
                      areaLabelStyle={gridItem}
                      helperText="Select the equipment areas you expect to work on and, when available, check the detailed tasks under each area."
                    />
                  </div>

                  <button type="submit" style={{ ...btnStartTime, width: 340 }}>
                    {isFirstWorkOrderOfDay ? "Start Day" : "Start Work Order"}
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>End Work Order</h2>

              <div style={{ fontSize: 14, opacity: 0.9 }}>
                <b>In progress:</b> {inProgress.location?.name ?? "—"} • Started: {fmtLocal(inProgress.startTime)}
              </div>

              {!canSubmitOwn ? (
                <div style={{ fontSize: 14, opacity: 0.85 }}>You don’t have permission to end/submit your work orders.</div>
              ) : (
                <form action={endWorkOrderAction} style={{ display: "grid", gap: 12 }}>
                  <input type="hidden" name="id" value={inProgress.id} />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={label}>
                      Starting Mileage
                      <input type="number" value={inProgress.startingMileage ?? ""} readOnly style={{ ...input, opacity: 0.85 }} />
                    </label>

                    <label style={label}>
                      Ending Mileage (required)
                      <input
                        name="endingMileage"
                        type="number"
                        defaultValue={inProgress.endingMileage ?? ""}
                        placeholder="e.g. 12555"
                        style={input}
                        required
                      />
                    </label>
                  </div>

                  <label style={label}>
                    Notes (optional, required if Other is selected)
                    <textarea
                      name="notes"
                      defaultValue={inProgress.notes ?? ""}
                      placeholder="What was done (optional)..."
                      style={{ ...textareaBase, minHeight: 110 }}
                    />
                  </label>

                  <WorkOrderEquipmentSelector
                    title="Equipment Areas (check what you worked on)"
                    templatesByArea={checklistItemsByArea}
                    selectedAreas={inProgressChecked}
                    selectedChecklistItemIds={buildChecklistItemIdSet(checklistSelectionsByWorkOrder[inProgress.id] ?? [])}
                    checkboxStyle={checkboxStyle}
                    gridWrapStyle={gridWrap}
                    areaLabelStyle={gridItem}
                    helperText="Detailed checklist selections are saved with the work order only when the parent equipment area is checked."
                  />

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button type="submit" style={{ ...btnEndTime, width: 340 }}>
                      End Work Order
                    </button>

                    <button
                      type="submit"
                      formAction={endDayAction}
                      style={{
                        ...btn,
                        width: 220,
                        background: "rgba(245, 158, 11, 0.18)",
                        border: "1px solid rgba(245, 158, 11, 0.5)",
                        boxShadow: "0 0 0 1px rgba(245, 158, 11, 0.12) inset",
                      }}
                    >
                      End Day
                    </button>
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    End Work Order carries the ending mileage into the next start form. End Day clears the next start mileage so the next button reads <b>Start Day</b>.
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        {/* LIST */}
        <div style={{ ...card, ...pageWidth, marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>My Recent Work Orders</h2>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr>
                  {["Created", "Status", "Location", "Start/End", "Mileage", "Areas", "Actions"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === "Actions" ? "right" : "left",
                        padding: "10px 10px",
                        borderBottom: "1px solid rgba(128,128,128,0.25)",
                        fontSize: 13,
                        opacity: 0.9,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {workOrders.map((wo) => {
                  const areasText = wo.equipmentAreas?.length
                    ? wo.equipmentAreas.map((a) => formatAreaLabelWithLegacy(a.area as EquipmentAreaDb)).join(", ")
                    : "—";
                  const checklistText = formatChecklistSelectionSummary(checklistSelectionsByWorkOrder[wo.id] ?? []);

                  const hasLegacy = wo.equipmentAreas?.some((a) => isLegacyArea(a.area as EquipmentAreaDb)) ?? false;

                  const isDraft = (wo.status as WorkOrderStatus) === "DRAFT";
                  const isSubmitted = (wo.status as WorkOrderStatus) === "SUBMITTED";
                  const isFinalized = (wo.status as WorkOrderStatus) === "FINALIZED";
                  const isOpenDraft = isDraft && wo.endTime === null;

                  const checked = new Set<string>((wo.equipmentAreas ?? []).map((x) => String(x.area)));

                  return (
                    <tr key={wo.id}>
                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        <div style={{ fontWeight: 900 }}>{fmtLocal(wo.createdAt)}</div>
                        <div style={{ fontSize: 13, opacity: 0.85 }}>id: {wo.id}</div>
                        {wo.workOrderNumber ? <div style={{ fontSize: 13, opacity: 0.85 }}>WO#: {wo.workOrderNumber}</div> : null}
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        <span style={{ fontWeight: 900 }}>{statusLabel(wo.status as WorkOrderStatus)}</span>
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        {wo.location?.name ?? "—"}
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        {fmtLocal(wo.startTime)} → {fmtLocal(wo.endTime)}
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        <span style={{ fontWeight: 900 }}>{wo.startingMileage ?? "—"}</span> →{" "}
                        <span style={{ fontWeight: 900 }}>{wo.endingMileage ?? "—"}</span>
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)", maxWidth: 560 }}>
                        {areasText}
                        {checklistText ? <div style={{ fontSize: 12, opacity: 0.82, marginTop: 4 }}>{checklistText}</div> : null}
                        {hasLegacy ? <div style={{ fontSize: 13, opacity: 0.85 }}>(contains legacy values)</div> : null}
                      </td>

                      <td
                        style={{
                          padding: "12px 10px",
                          borderBottom: "1px solid rgba(128,128,128,0.18)",
                          textAlign: "right",
                          verticalAlign: "top",
                          width: 260,
                        }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <a href={`/maintenance/work-orders/${wo.id}`} style={{ ...btnPictures, height: 36, padding: "0 12px", fontSize: 13 }}>
                            Pictures
                          </a>
                        </div>

                        {canUpdateOwn && (isOpenDraft || isSubmitted) ? (
                          <details style={{ marginLeft: "auto", textAlign: "left", display: "inline-block", width: "100%" }}>
                            <summary style={{ cursor: "pointer", fontWeight: 900, textAlign: "right" }}>Edit</summary>

                            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                              <form action={updateWorkOrderFromListAction} style={{ display: "grid", gap: 10 }}>
                                <input type="hidden" name="id" value={wo.id} />

                                <label style={label}>
                                  Location
                                  <select name="locationId" defaultValue={wo.locationId} style={input}>
                                    {allowedLocations.map((l) => (
                                      <option key={`${wo.id}-loc-${l.id}`} value={l.id}>
                                        {l.name}
                                        {l.source === "PRIMARY" ? " (Primary)" : ""}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                  <label style={label}>
                                    Start Time
                                    <input
                                      name="startTime"
                                      type="datetime-local"
                                      defaultValue={fmtForDatetimeLocal(wo.startTime)}
                                      style={input}
                                    />
                                  </label>

                                  <label style={label}>
                                    End Time {isSubmitted ? "(required)" : "(optional)"}
                                    <input
                                      name="endTime"
                                      type="datetime-local"
                                      defaultValue={fmtForDatetimeLocal(wo.endTime)}
                                      style={input}
                                      required={isSubmitted}
                                    />
                                  </label>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <label style={label}>
                                  Starting Mileage (optional)
                                  <input
                                    name="startingMileage"
                                    type="number"
                                    defaultValue={wo.startingMileage ?? ""}
                                    style={input}
                                    placeholder="e.g. 12345"
                                  />
                                </label>

                                  <label style={label}>
                                    Ending Mileage {isSubmitted ? "(required)" : "(optional)"}
                                    <input
                                      name="endingMileage"
                                      type="number"
                                      defaultValue={wo.endingMileage ?? ""}
                                      style={input}
                                      required={isSubmitted}
                                    />
                                  </label>
                                </div>

                                <label style={label}>
                                  Notes (optional, required if Other is selected)
                                  <textarea name="notes" defaultValue={wo.notes ?? ""} style={{ ...textareaBase, minHeight: 90 }} />
                                </label>

                                <WorkOrderEquipmentSelector
                                  title="Equipment Areas"
                                  templatesByArea={checklistItemsByArea}
                                  selectedAreas={checked}
                                  selectedChecklistItemIds={buildChecklistItemIdSet(checklistSelectionsByWorkOrder[wo.id] ?? [])}
                                  checkboxStyle={checkboxStyle}
                                  gridWrapStyle={gridWrap}
                                  areaLabelStyle={gridItem}
                                />

                                <button type="submit" style={{ ...btnSaveEdit, width: 240 }}>
                                  Save Changes
                                </button>

                                <div style={{ fontSize: 12, opacity: 0.75 }}>
                                  You can edit all fields for <b>IN PROGRESS</b> and <b>PENDING</b> work orders.
                                  ARCHIVED work orders stay locked.
                                </div>
                              </form>
                            </div>
                          </details>
                        ) : null}

                        {isFinalized ? <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>Archived</div> : null}

                        {!isOpenDraft && !isSubmitted && !isFinalized ? (
                          <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>—</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}

                {workOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 14, opacity: 0.85 }}>
                      No work orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: 14, opacity: 0.85 }}>
            You can edit your own IN PROGRESS and PENDING work orders from this list, including location, times,
            mileage, notes, and equipment areas. ARCHIVED work orders are locked.
          </div>
        </div>
      </div>
    </main>
  );
}
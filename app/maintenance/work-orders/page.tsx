// app/maintenance/work-orders/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

type SearchParams = {
  edit?: string; // workOrderId
};

type SessionShape = {
  user?: {
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  const email = session.user?.email ?? null;
  if (!email) redirect("/login");
}

async function requireWorkOrdersView(session: SessionShape) {
  requireSession(session);

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return perms;

  const ok = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  if (!ok) redirect("/");
  return perms;
}

async function requireWorkOrdersCreate(session: SessionShape) {
  requireSession(session);

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return perms;

  const ok = hasAnyPermission(perms, [Permission.CREATE_WORK_ORDERS]);
  if (!ok) redirect("/");
  return perms;
}

async function requireWorkOrdersSubmitOwn(session: SessionShape) {
  requireSession(session);

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return perms;

  const ok = hasAnyPermission(perms, [Permission.SUBMIT_OWN_WORK_ORDERS]);
  if (!ok) redirect("/");
  return perms;
}

type WorkOrderStatus = "DRAFT" | "SUBMITTED" | "FINALIZED";

type EquipmentArea =
  | "DOUGH_ROLLER"
  | "MAKETABLE"
  | "DOUGH_COOLER"
  | "MIXER"
  | "OVEN"
  | "WALK_IN"
  | "FREEZER"
  | "BUILDING_STRUCTURE"
  | "LIGHTING"
  | "PARKING_LOT"
  | "OFFICE"
  | "HVAC_GAME_ROOM"
  | "HVAC_KITCHEN"
  | "HVAC_DINING_ROOM"
  | "OTHER";

type LegacyEquipmentArea = "FRONT_COUNTER" | "DRIVE_THRU" | "KITCHEN" | "ROOF" | "HVAC";
type EquipmentAreaDb = EquipmentArea | LegacyEquipmentArea;

const EQUIPMENT_AREAS: EquipmentArea[] = [
  "DOUGH_ROLLER",
  "MAKETABLE",
  "DOUGH_COOLER",
  "MIXER",
  "OVEN",
  "WALK_IN",
  "FREEZER",
  "BUILDING_STRUCTURE",
  "LIGHTING",
  "PARKING_LOT",
  "OFFICE",
  "HVAC_GAME_ROOM",
  "HVAC_KITCHEN",
  "HVAC_DINING_ROOM",
  "OTHER",
];

const LEGACY_AREAS: LegacyEquipmentArea[] = ["FRONT_COUNTER", "DRIVE_THRU", "KITCHEN", "ROOF", "HVAC"];
const STATUSES: WorkOrderStatus[] = ["DRAFT", "SUBMITTED", "FINALIZED"];

function isLegacyArea(a: EquipmentAreaDb): a is LegacyEquipmentArea {
  return (LEGACY_AREAS as readonly string[]).includes(a);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseAreas(formData: FormData): EquipmentArea[] {
  const raw = formData.getAll("areas");
  const allowed = new Set<string>(EQUIPMENT_AREAS);

  const out: EquipmentArea[] = [];
  for (const v of raw) {
    if (!isNonEmptyString(v)) continue;
    const s = v.trim();
    if (!allowed.has(s)) continue;
    out.push(s as EquipmentArea);
  }

  // de-dupe preserving order
  const seen = new Set<EquipmentArea>();
  const uniq: EquipmentArea[] = [];
  for (const a of out) {
    if (seen.has(a)) continue;
    seen.add(a);
    uniq.push(a);
  }
  return uniq;
}

function parseOptionalInt(v: FormDataEntryValue | null): number | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseRequiredInt(v: FormDataEntryValue | null, label: string): number {
  const n = parseOptionalInt(v);
  if (n === null) throw new Error(`${label} is required.`);
  return n;
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
  const parts = area.split("_").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const up = p.toUpperCase();
    if (up === "HVAC") {
      out.push("HVAC");
      continue;
    }
    if (up === "DOUGH") {
      out.push("Dough");
      continue;
    }
    out.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  }
  return out.join(" ");
}

function formatAreaLabelWithLegacy(area: EquipmentAreaDb): string {
  const label = formatAreaLabel(area);
  return isLegacyArea(area) ? `${label} (legacy)` : label;
}

function statusLabel(s: WorkOrderStatus): string {
  if (s === "DRAFT") return "IN PROGRESS";
  return s;
}

export default async function MaintenanceWorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  const perms = await requireWorkOrdersView(session);

  const isAdmin = !!perms.allowAll || session?.user?.role === Role.ADMIN;

  const email = (session?.user?.email ?? "").toLowerCase().trim();
  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      role: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      allowedLocations: {
        orderBy: { sortOrder: "asc" },
        select: { locationId: true, sortOrder: true, location: { select: { id: true, name: true } } },
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const sp = await searchParams;
  const editId = (sp.edit ?? "").trim() || null;

  // Allowed locations: primary first, then optionals (dedup)
  const allowedLocations: Array<{ id: string; name: string; source: "PRIMARY" | "OPTIONAL" }> = [];
  const seen = new Set<string>();

  if (me.location) {
    seen.add(me.location.id);
    allowedLocations.push({ id: me.location.id, name: me.location.name, source: "PRIMARY" });
  }

  for (const ul of me.allowedLocations) {
    if (!ul.location) continue;
    if (seen.has(ul.location.id)) continue;
    seen.add(ul.location.id);
    allowedLocations.push({ id: ul.location.id, name: ul.location.name, source: "OPTIONAL" });
  }

  // Find ONE active in-progress work order (DRAFT + no endTime)
  const inProgress = await prisma.workOrder.findFirst({
    where: { createdByUserId: me.id, status: "DRAFT", endTime: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
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

  // Edit target (if ?edit=...)
  const editTarget = editId
    ? await prisma.workOrder.findUnique({
        where: { id: editId },
        select: {
          id: true,
          createdByUserId: true,
          status: true,
          createdAt: true,
          startTime: true,
          endTime: true,
          locationId: true,
          location: { select: { name: true } },
          notes: true,
          startingMileage: true,
          endingMileage: true,
          equipmentAreas: { select: { area: true } },
        },
      })
    : null;

  if (editId && !editTarget) {
    // invalid id; just show normal page
    // (no redirect to preserve "one file" simplicity)
  }

  // For non-admin, restrict editing to own records
  const canEditTarget = editTarget ? isAdmin || editTarget.createdByUserId === me.id : false;

  const workOrders = await prisma.workOrder.findMany({
    where: { createdByUserId: me.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      status: true,
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

  /**
   * STYLE TUNING (requested)
   */
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

  const btnNeutral: CSSProperties = {
    ...btn,
    height: 42,
    fontSize: 14,
    padding: "0 12px",
    borderRadius: 10,
  };

  const btnDangerSmall: CSSProperties = {
    ...btnNeutral,
    background: "rgba(220, 60, 60, 0.16)",
    border: "1px solid rgba(220, 60, 60, 0.45)",
  };

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
    const p = await requireWorkOrdersCreate(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        allowedLocations: { select: { locationId: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!me || !me.active) redirect("/login");

    // Prevent multiple in-progress orders
    const existing = await prisma.workOrder.findFirst({
      where: { createdByUserId: me.id, status: "DRAFT", endTime: null },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) redirect("/maintenance/work-orders");

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required");

    // Enforce allowed location (non-admin)
    if (!p.allowAll) {
      const allowed = new Set<string>();
      if (me.locationId) allowed.add(me.locationId);
      for (const ul of me.allowedLocations) allowed.add(ul.locationId);
      if (!allowed.has(locationId)) throw new Error("You are not allowed to create a work order for that location.");
    }

    const notes = String(formData.get("notes") ?? "");
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const areas = parseAreas(formData);

    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          locationId,
          status: "DRAFT",
          notes,
          startingMileage,
          startTime: new Date(), // Start sets startTime immediately
          createdByUserId: me.id,
        },
        select: { id: true },
      });

      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: wo.id, area })),
        });
      }
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders");
  }

  async function endWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireWorkOrdersSubmitOwn(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const endingMileage = parseRequiredInt(formData.get("endingMileage"), "Ending mileage");
    const notes = String(formData.get("notes") ?? "");
    const areas = parseAreas(formData);

    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUnique({
        where: { id },
        select: { id: true, createdByUserId: true, status: true, endTime: true },
      });
      if (!wo || wo.createdByUserId !== me.id) throw new Error("Work order not found.");
      if (wo.status !== "DRAFT" || wo.endTime !== null) throw new Error("Work order is already ended.");

      await tx.workOrder.update({
        where: { id },
        data: {
          endTime: new Date(),
          endingMileage,
          notes,
          status: "SUBMITTED", // End auto-submits
        },
      });

      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: id, area })),
        });
      }
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders");
  }

  async function saveEditAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    const p = await requireWorkOrdersSubmitOwn(session);

    const isAdmin = !!p.allowAll || session?.user?.role === Role.ADMIN;

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        allowedLocations: { select: { locationId: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) throw new Error("Work order not found");
    if (!isAdmin && wo.createdByUserId !== me.id) throw new Error("You can only edit your own work orders.");

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required");

    // non-admin must stay within allowed locations
    if (!isAdmin) {
      const allowed = new Set<string>();
      if (me.locationId) allowed.add(me.locationId);
      for (const ul of me.allowedLocations) allowed.add(ul.locationId);
      if (!allowed.has(locationId)) throw new Error("You are not allowed to move a work order to that location.");
    }

    const statusRaw = String(formData.get("status") ?? "").trim().toUpperCase();
    const status: WorkOrderStatus | null = STATUSES.includes(statusRaw as WorkOrderStatus)
      ? (statusRaw as WorkOrderStatus)
      : null;
    if (!status) throw new Error("Invalid status");

    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));
    const notes = String(formData.get("notes") ?? "");
    const areas = parseAreas(formData);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          locationId,
          status,
          startingMileage,
          endingMileage,
          notes,
        },
      });

      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: id, area })),
        });
      }
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders?edit=" + encodeURIComponent(id));
  }

  async function setStartNowAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    const p = await requireWorkOrdersSubmitOwn(session);
    const isAdmin = !!p.allowAll || session?.user?.role === Role.ADMIN;

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) throw new Error("Work order not found");
    if (!isAdmin && wo.createdByUserId !== me.id) throw new Error("You can only modify your own work orders.");

    await prisma.workOrder.update({
      where: { id },
      data: { startTime: new Date() },
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders?edit=" + encodeURIComponent(id));
  }

  async function setEndNowAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    const p = await requireWorkOrdersSubmitOwn(session);
    const isAdmin = !!p.allowAll || session?.user?.role === Role.ADMIN;

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) throw new Error("Work order not found");
    if (!isAdmin && wo.createdByUserId !== me.id) throw new Error("You can only modify your own work orders.");

    await prisma.workOrder.update({
      where: { id },
      data: { endTime: new Date() },
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders?edit=" + encodeURIComponent(id));
  }

  async function clearEndTimeAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    const p = await requireWorkOrdersSubmitOwn(session);
    const isAdmin = !!p.allowAll || session?.user?.role === Role.ADMIN;

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) throw new Error("Work order not found");
    if (!isAdmin && wo.createdByUserId !== me.id) throw new Error("You can only modify your own work orders.");

    await prisma.workOrder.update({
      where: { id },
      data: { endTime: null },
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders?edit=" + encodeURIComponent(id));
  }

  async function purgeWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    const p = await requireWorkOrdersSubmitOwn(session);
    const isAdmin = !!p.allowAll || session?.user?.role === Role.ADMIN;

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const confirmText = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirmText !== "DELETE") throw new Error('Type "DELETE" to confirm purge.');

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) throw new Error("Work order not found");
    if (!isAdmin && wo.createdByUserId !== me.id) throw new Error("You can only purge your own work orders.");

    await prisma.$transaction(async (tx) => {
      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
    });

    revalidatePath("/maintenance/work-orders");
    redirect("/maintenance/work-orders");
  }

  const inProgressChecked = new Set<string>(inProgress?.equipmentAreas?.map((x) => String(x.area)) ?? []);
  const editChecked = new Set<string>(editTarget?.equipmentAreas?.map((x) => String(x.area)) ?? []);

  return (
    <main>
      <div style={shell}>
        <div style={pageWidth}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Maintenance: Work Orders</h1>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            Times displayed in <b>{TZ}</b>.
          </div>
        </div>

        {/* EDIT PANEL (if ?edit=...) */}
        {editTarget && canEditTarget ? (
          <div style={{ ...card, ...pageWidth, marginTop: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Edit Work Order</h2>
              <div style={{ opacity: 0.85, fontSize: 13 }}>id: {editTarget.id}</div>
              <a
                href="/maintenance/work-orders"
                style={{
                  marginLeft: "auto",
                  textDecoration: "none",
                  ...btnNeutral,
                }}
              >
                Close
              </a>
            </div>

            <div style={{ fontSize: 14, opacity: 0.9 }}>
              <b>Created:</b> {fmtLocal(editTarget.createdAt)} • <b>Start:</b> {fmtLocal(editTarget.startTime)} •{" "}
              <b>End:</b> {fmtLocal(editTarget.endTime)}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <form action={setStartNowAction}>
                <input type="hidden" name="id" value={editTarget.id} />
                <button type="submit" style={btnNeutral}>
                  Set Start Now
                </button>
              </form>
              <form action={setEndNowAction}>
                <input type="hidden" name="id" value={editTarget.id} />
                <button type="submit" style={btnNeutral}>
                  Set End Now
                </button>
              </form>
              <form action={clearEndTimeAction}>
                <input type="hidden" name="id" value={editTarget.id} />
                <button type="submit" style={btnNeutral}>
                  Clear End Time
                </button>
              </form>
            </div>

            <form action={saveEditAction} style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="id" value={editTarget.id} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={label}>
                  Location
                  <select
                    name="locationId"
                    defaultValue={editTarget.locationId}
                    style={input}
                    required
                    disabled={!isAdmin && allowedLocations.length === 0}
                  >
                    {(isAdmin ? allowedLocations : allowedLocations).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.source === "PRIMARY" ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={label}>
                  Status
                  <select name="status" defaultValue={editTarget.status} style={input} required>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={label}>
                  Starting Mileage
                  <input
                    name="startingMileage"
                    type="number"
                    defaultValue={editTarget.startingMileage ?? ""}
                    placeholder="e.g. 12345"
                    style={input}
                  />
                </label>

                <label style={label}>
                  Ending Mileage
                  <input
                    name="endingMileage"
                    type="number"
                    defaultValue={editTarget.endingMileage ?? ""}
                    placeholder="e.g. 12555"
                    style={input}
                  />
                </label>
              </div>

              <label style={label}>
                Notes
                <textarea name="notes" defaultValue={editTarget.notes ?? ""} style={{ ...textareaBase, minHeight: 110 }} />
              </label>

              <div>
                <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>Equipment Areas</div>
                <div style={gridWrap}>
                  {EQUIPMENT_AREAS.map((area) => (
                    <label key={`edit-area-${area}`} style={gridItem}>
                      <input type="checkbox" name="areas" value={area} defaultChecked={editChecked.has(area)} style={checkboxStyle} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {formatAreaLabel(area)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" style={{ ...btnNeutral, width: 220, height: 50 }}>
                Save Changes
              </button>
            </form>

            {/* PURGE */}
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px solid rgba(128,128,128,0.22)" }}>
              <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Purge (Delete)</div>
              <form action={purgeWorkOrderAction} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
                <input type="hidden" name="id" value={editTarget.id} />
                <div style={{ fontSize: 13, opacity: 0.85 }}>
                  Type <code>DELETE</code> to permanently purge this work order.
                </div>
                <input name="confirm" placeholder="DELETE" style={input} />
                <button type="submit" style={{ ...btnDangerSmall, width: 260 }}>
                  Purge Work Order
                </button>
              </form>
            </div>
          </div>
        ) : editTarget && !canEditTarget ? (
          <div style={{ ...card, ...pageWidth, marginTop: 14, fontSize: 14, opacity: 0.9 }}>
            You can’t edit that work order.
            <a href="/maintenance/work-orders" style={{ marginLeft: 10 }}>
              Back
            </a>
          </div>
        ) : null}

        {/* TOP CARD: Start OR End */}
        <div style={{ ...card, ...pageWidth, marginTop: 14, display: "grid", gap: 12 }}>
          {!inProgress ? (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Start Work Order</h2>

              {allowedLocations.length === 0 ? (
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
                      Starting Mileage (optional)
                      <input name="startingMileage" type="number" placeholder="e.g. 12345" style={input} />
                    </label>
                  </div>

                  <label style={label}>
                    Notes (optional)
                    <textarea name="notes" placeholder="Short description (optional)..." style={textareaBase} />
                  </label>

                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>Equipment Areas (optional)</div>
                    <div style={gridWrap}>
                      {EQUIPMENT_AREAS.map((area) => (
                        <label key={`start-area-${area}`} style={gridItem}>
                          <input type="checkbox" name="areas" value={area} style={checkboxStyle} />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {formatAreaLabel(area)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button type="submit" style={{ ...btnStartTime, width: 340 }}>
                    Start (sets Start Time)
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

              <form action={endWorkOrderAction} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="id" value={inProgress.id} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={label}>
                    Starting Mileage
                    <input
                      type="number"
                      value={inProgress.startingMileage ?? ""}
                      readOnly
                      style={{ ...input, opacity: 0.85 }}
                    />
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
                  Notes (optional)
                  <textarea
                    name="notes"
                    defaultValue={inProgress.notes ?? ""}
                    placeholder="What was done (optional)..."
                    style={{ ...textareaBase, minHeight: 110 }}
                  />
                </label>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>
                    Equipment Areas (check what you worked on)
                  </div>
                  <div style={gridWrap}>
                    {EQUIPMENT_AREAS.map((area) => (
                      <label key={`end-area-${area}`} style={gridItem}>
                        <input
                          type="checkbox"
                          name="areas"
                          value={area}
                          defaultChecked={inProgressChecked.has(area)}
                          style={checkboxStyle}
                        />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {formatAreaLabel(area)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <button type="submit" style={{ ...btnEndTime, width: 340 }}>
                  End (sets End Time + Submits)
                </button>

                <div style={{ fontSize: 14, opacity: 0.85 }}>
                  This will set <b>end time</b>, save mileage/notes/areas, mark the work order <b>SUBMITTED</b>, and
                  return you to the Start screen.
                </div>
              </form>
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
                  {["Created", "Status", "Location", "Start/End", "Mileage", "Areas", "Edit"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
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
                  const areas = wo.equipmentAreas?.length
                    ? wo.equipmentAreas.map((a) => formatAreaLabelWithLegacy(a.area as EquipmentAreaDb)).join(", ")
                    : "—";

                  const hasLegacy = wo.equipmentAreas?.some((a) => isLegacyArea(a.area as EquipmentAreaDb)) ?? false;

                  return (
                    <tr key={wo.id}>
                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        <div style={{ fontWeight: 900 }}>{fmtLocal(wo.createdAt)}</div>
                        <div style={{ fontSize: 13, opacity: 0.85 }}>id: {wo.id}</div>
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

                      <td
                        style={{
                          padding: "12px 10px",
                          borderBottom: "1px solid rgba(128,128,128,0.18)",
                          maxWidth: 520,
                        }}
                      >
                        {areas}
                        {hasLegacy ? <div style={{ fontSize: 13, opacity: 0.85 }}>(contains legacy values)</div> : null}
                      </td>

                      <td style={{ padding: "12px 10px", borderBottom: "1px solid rgba(128,128,128,0.18)" }}>
                        <a
                          href={`/maintenance/work-orders?edit=${encodeURIComponent(wo.id)}`}
                          style={{ ...btnNeutral, textDecoration: "none" }}
                        >
                          Edit
                        </a>
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
            This page uses a simple Start → End flow (no separate Submit screen).
          </div>
        </div>
      </div>
    </main>
  );
}
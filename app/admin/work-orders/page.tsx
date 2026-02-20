// app/admin/work-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireAdminWorkOrdersView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS]);
  if (!ok) redirect("/");

  return session;
}

async function requireAdminWorkOrdersEdit() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_WORK_ORDERS]);
  if (!ok) redirect("/");

  return session;
}

async function requireAdminWorkOrdersDelete() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_DELETE_WORK_ORDERS]);
  if (!ok) redirect("/");

  return session;
}

/**
 * Keep these as string unions so this page works even if Prisma Client enums
 * aren't regenerated yet.
 */
type WorkOrderStatus = "DRAFT" | "SUBMITTED" | "FINALIZED";

/**
 * UI/requirements equipment areas (selectable)
 */
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

/**
 * Legacy values that may exist in DB from earlier enum iterations.
 * These must be accepted for READ to avoid runtime decode issues / TS unsoundness.
 */
type LegacyEquipmentArea = "FRONT_COUNTER" | "DRIVE_THRU" | "KITCHEN" | "ROOF" | "HVAC";

/**
 * What can come back from the DB
 */
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

type SearchParams = {
  q?: string;
  status?: string;
  locationId?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  page?: string; // 1-based
  perPage?: string; // 10/25/50/100
};

type LocationRow = { id: string; name: string };
type WorkOrderEquipmentAreaRow = { area: EquipmentAreaDb };

type WorkOrderRow = {
  id: string;
  status: WorkOrderStatus;
  notes: string | null;
  startTime: Date | null;
  endTime: Date | null;
  startingMileage: number | null;
  endingMileage: number | null;
  createdAt: Date;
  updatedAt: Date;

  locationId: string;
  location: { name: string };

  createdByUserId: string;
  createdByUser?: { name: string; email: string } | null;

  equipmentAreas: WorkOrderEquipmentAreaRow[];
};

/**
 * TS-only shim until Prisma Client types are regenerated.
 * Avoids `prisma.workOrder` property errors in TS.
 */
type PrismaWorkOrderDelegate = {
  findMany: (args: unknown) => Promise<WorkOrderRow[]>;
  count: (args: unknown) => Promise<number>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

type PrismaWorkOrderEquipmentAreaDelegate = {
  deleteMany: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
};

type PrismaTx = {
  workOrder: PrismaWorkOrderDelegate;
  workOrderEquipmentArea: PrismaWorkOrderEquipmentAreaDelegate;
};

const db = prisma as unknown as {
  workOrder: PrismaWorkOrderDelegate;
  workOrderEquipmentArea: PrismaWorkOrderEquipmentAreaDelegate;
  location: { findMany: (args: unknown) => Promise<LocationRow[]> };
  $transaction: <T>(fn: (tx: PrismaTx) => Promise<T>) => Promise<T>;
};

function parseAreas(formData: FormData): EquipmentArea[] {
  const raw = formData.getAll("areas");
  const allowed = new Set<string>(EQUIPMENT_AREAS);

  const out: EquipmentArea[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
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

function parseOptionalDateTimeLocal(v: FormDataEntryValue | null): Date | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtForDatetimeLocal(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 16);
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

function isLegacyArea(area: EquipmentAreaDb): area is LegacyEquipmentArea {
  return (LEGACY_AREAS as readonly string[]).includes(area);
}

function formatAreaLabelWithLegacy(area: EquipmentAreaDb): string {
  const label = formatAreaLabel(area);
  return isLegacyArea(area) ? `${label} (legacy)` : label;
}

function statusLabel(s: WorkOrderStatus): string {
  if (s === "DRAFT") return "IN PROGRESS";
  if (s === "SUBMITTED") return "SUBMITTED";
  if (s === "FINALIZED") return "FINALIZED";
  return s;
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/admin/work-orders";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/admin/work-orders";
  } catch {
    return "/admin/work-orders";
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseDateStart(dateStr: string): Date | null {
  const s = (dateStr || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEndInclusive(dateStr: string): Date | null {
  const s = (dateStr || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function AdminWorkOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminWorkOrdersView();

  const q = (searchParams.q ?? "").trim();
  const statusRaw = (searchParams.status ?? "").trim().toUpperCase();
  const status: WorkOrderStatus | "" = STATUSES.includes(statusRaw as WorkOrderStatus)
    ? (statusRaw as WorkOrderStatus)
    : "";

  const locationId = (searchParams.locationId ?? "").trim();

  const fromStr = (searchParams.from ?? "").trim();
  const toStr = (searchParams.to ?? "").trim();
  const from = parseDateStart(fromStr);
  const to = parseDateEndInclusive(toStr);

  const page = clamp(Number(searchParams.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set([10, 25, 50, 100]);
  const perPage = perPageAllowed.has(Number(searchParams.perPage)) ? Number(searchParams.perPage) : 25;

  // Build Prisma where clause (typed as unknown due to shim)
  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (locationId) where.locationId = locationId;

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { location: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  const skip = (page - 1) * perPage;

  const [locations, total, workOrders] = await Promise.all([
    db.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.workOrder.count({ where }),
    db.workOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: perPage,
      skip,
      include: {
        location: { select: { name: true } },
        equipmentAreas: true,
        createdByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / perPage));

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const soft = "rgba(255,255,255,0.03)";

  // Unified control styling (fixes misalignment + keeps actions inside card)
  const controlLabel: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const controlBase: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
    minWidth: 0,
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const btnSecondary: CSSProperties = { ...btn, opacity: 0.92 };

  const gridWrapStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 10,
    marginTop: 8,
  };

  const gridLabelStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border,
    borderRadius: 8,
    fontSize: 13,
    background: soft,
  };

  const gridTextStyle: CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  async function updateWorkOrder(formData: FormData) {
    "use server";

    await requireAdminWorkOrdersEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required");

    const statusRaw = String(formData.get("status") ?? "").trim().toUpperCase();
    const status: WorkOrderStatus | null = STATUSES.includes(statusRaw as WorkOrderStatus)
      ? (statusRaw as WorkOrderStatus)
      : null;
    if (!status) throw new Error("Invalid status");

    const notes = String(formData.get("notes") ?? "");

    const startTime = parseOptionalDateTimeLocal(formData.get("startTime"));
    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));

    // IMPORTANT: only allow current UI list areas to be saved
    const areas = parseAreas(formData);

    await db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          locationId,
          status,
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
    });

    revalidatePath("/admin/work-orders");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  async function deleteWorkOrder(formData: FormData) {
    "use server";

    await requireAdminWorkOrdersDelete();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const confirmText = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirmText !== "DELETE") {
      throw new Error('Type "DELETE" to confirm deletion.');
    }

    await db.$transaction(async (tx) => {
      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
    });

    revalidatePath("/admin/work-orders");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  // Helper to build pagination links while preserving filters
  function buildHref(next: Partial<SearchParams>) {
    const sp = new URLSearchParams();
    const merged: SearchParams = {
      q: q || undefined,
      status: status || undefined,
      locationId: locationId || undefined,
      from: fromStr || undefined,
      to: toStr || undefined,
      page: String(page),
      perPage: String(perPage),
      ...next,
    };

    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined) continue;
      if (String(v).trim() === "") continue;
      sp.set(k, String(v));
    }

    const qs = sp.toString();
    return qs ? `/admin/work-orders?${qs}` : "/admin/work-orders";
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: fg }}>
        <h1 style={{ fontSize: 26, fontWeight: 900 }}>Admin: Work Orders</h1>

        {/* FILTERS */}
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border,
            borderRadius: 12,
            background: surface,
          }}
        >
          <form method="get" action="/admin/work-orders" style={{ display: "grid", gap: 10 }}>
            {/* One aligned row; actions stay inside the card */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(240px, 2fr) minmax(140px, 1fr) minmax(200px, 1.2fr) minmax(150px, 0.9fr) minmax(150px, 0.9fr) minmax(120px, 0.7fr) auto",
                gap: 10,
                alignItems: "end",
                width: "100%",
              }}
            >
              <label style={controlLabel}>
                Search
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Notes, location, creator, ID..."
                  style={controlBase}
                />
              </label>

              <label style={controlLabel}>
                Status
                <select name="status" defaultValue={status || ""} style={controlBase}>
                  <option value="">All</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={controlLabel}>
                Location
                <select name="locationId" defaultValue={locationId || ""} style={controlBase}>
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={controlLabel}>
                From
                <input type="date" name="from" defaultValue={fromStr} style={controlBase} />
              </label>

              <label style={controlLabel}>
                To
                <input type="date" name="to" defaultValue={toStr} style={controlBase} />
              </label>

              <label style={controlLabel}>
                Per page
                <select name="perPage" defaultValue={String(perPage)} style={controlBase}>
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "end" }}>
                {/* Reset page when submitting filters */}
                <input type="hidden" name="page" value="1" />
                <button type="submit" style={btn}>
                  Apply
                </button>
                <Link href="/admin/work-orders" style={{ ...btnSecondary, textDecoration: "none", display: "inline-block" }}>
                  Clear
                </Link>
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Showing <b>{workOrders.length}</b> of <b>{total}</b> results • Page <b>{page}</b> / <b>{pageCount}</b>
            </div>
          </form>
        </div>

        {/* TABLE */}
        <div style={{ marginTop: 14, overflowX: "auto", border, borderRadius: 12, background: surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Created", "Location", "Created By", "Status", "Start/End", "Mileage", "Areas", "Edit", "Delete"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: border,
                        fontSize: 12,
                        opacity: 0.85,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {workOrders.map((wo) => {
                const creator = wo.createdByUser
                  ? `${wo.createdByUser.name} (${wo.createdByUser.email})`
                  : wo.createdByUserId;

                const areas = wo.equipmentAreas?.length
                  ? wo.equipmentAreas.map((a) => formatAreaLabelWithLegacy(a.area)).join(", ")
                  : "—";

                return (
                  <tr key={wo.id} style={{ borderBottom: border }}>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(wo.createdAt)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{wo.location?.name ?? "—"}</td>
                    <td style={{ padding: 10, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{creator}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{statusLabel(wo.status)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {fmtLocal(wo.startTime)} → {fmtLocal(wo.endTime)}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {wo.startingMileage ?? "—"} → {wo.endingMileage ?? "—"}
                    </td>
                    <td style={{ padding: 10, maxWidth: 320 }}>{areas}</td>

                    {/* EDIT */}
                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <details>
                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Edit</summary>

                        <form
                          action={updateWorkOrder}
                          style={{
                            marginTop: 10,
                            padding: 10,
                            border,
                            borderRadius: 10,
                            background: soft,
                            display: "grid",
                            gap: 10,
                            minWidth: 520,
                          }}
                        >
                          <input type="hidden" name="id" value={wo.id} />

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9, minWidth: 260 }}>
                              Location
                              <select name="locationId" defaultValue={wo.locationId} style={controlBase}>
                                {locations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                              Status
                              <select name="status" defaultValue={wo.status} style={controlBase}>
                                {STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {statusLabel(s)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                            Notes
                            <textarea
                              name="notes"
                              defaultValue={wo.notes ?? ""}
                              placeholder="Notes..."
                              style={{ ...controlBase, minHeight: 90, resize: "vertical" }}
                            />
                          </label>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                              Start Time
                              <input
                                type="datetime-local"
                                name="startTime"
                                defaultValue={fmtForDatetimeLocal(wo.startTime)}
                                style={controlBase}
                              />
                            </label>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                              End Time
                              <input
                                type="datetime-local"
                                name="endTime"
                                defaultValue={fmtForDatetimeLocal(wo.endTime)}
                                style={controlBase}
                              />
                            </label>
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                              Starting Mileage
                              <input
                                type="number"
                                name="startingMileage"
                                defaultValue={wo.startingMileage ?? ""}
                                placeholder="Start mileage"
                                style={{ ...controlBase, width: 180 }}
                              />
                            </label>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
                              Ending Mileage
                              <input
                                type="number"
                                name="endingMileage"
                                defaultValue={wo.endingMileage ?? ""}
                                placeholder="End mileage"
                                style={{ ...controlBase, width: 180 }}
                              />
                            </label>
                          </div>

                          <div style={gridWrapStyle}>
                            {EQUIPMENT_AREAS.map((area) => (
                              <label key={area} style={gridLabelStyle}>
                                <input
                                  type="checkbox"
                                  name="areas"
                                  value={area}
                                  defaultChecked={wo.equipmentAreas.some((a) => a.area === area)}
                                />
                                <span style={gridTextStyle}>{formatAreaLabel(area)}</span>
                              </label>
                            ))}
                          </div>

                          <button type="submit" style={btn}>
                            Save
                          </button>

                          {wo.equipmentAreas.some((a) => isLegacyArea(a.area)) ? (
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              This work order currently contains legacy area values. Saving will replace areas with the current
                              checkbox selections only.
                            </div>
                          ) : null}
                        </form>
                      </details>
                    </td>

                    {/* DELETE */}
                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <details>
                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Delete</summary>
                        <form
                          action={deleteWorkOrder}
                          style={{
                            marginTop: 10,
                            padding: 10,
                            border,
                            borderRadius: 10,
                            background: soft,
                            display: "grid",
                            gap: 8,
                            minWidth: 260,
                          }}
                        >
                          <input type="hidden" name="id" value={wo.id} />
                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            Type <code>DELETE</code> to confirm.
                          </div>
                          <input name="confirm" placeholder="DELETE" style={controlBase} />
                          <button type="submit" style={btn}>
                            Permanently Delete
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                );
              })}

              {workOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 14, opacity: 0.8 }}>
                    No work orders found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href={buildHref({ page: String(Math.max(1, page - 1)) })}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: page <= 1 ? 0.5 : 0.95,
              pointerEvents: page <= 1 ? "none" : "auto",
            }}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : 0}
          >
            Prev
          </Link>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Page <b>{page}</b> of <b>{pageCount}</b>
          </div>

          <Link
            href={buildHref({ page: String(Math.min(pageCount, page + 1)) })}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: page >= pageCount ? 0.5 : 0.95,
              pointerEvents: page >= pageCount ? "none" : "auto",
            }}
            aria-disabled={page >= pageCount}
            tabIndex={page >= pageCount ? -1 : 0}
          >
            Next
          </Link>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Edit saves changes and replaces equipment areas atomically. Delete requires typing <code>DELETE</code>.
        </div>
      </div>
    </main>
  );
}

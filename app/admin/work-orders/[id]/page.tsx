// app/admin/work-orders/[id]/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    email?: string | null;
    role?: unknown;
  } | null;
} | null;

async function requireAdmin(session: AdminSession) {
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
}

/**
 * Keep as string unions so this page works even if Prisma Client enums
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

  updatedByUserId: string | null;
  updatedByUser?: { name: string; email: string } | null;

  equipmentAreas: WorkOrderEquipmentAreaRow[];
};

/**
 * TS-only shim until Prisma Client types are regenerated.
 */
type PrismaWorkOrderDelegate = {
  findUnique: (args: unknown) => Promise<WorkOrderRow | null>;
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
  location: { findMany: (args: unknown) => Promise<LocationRow[]> };
};

const db = prisma as unknown as {
  workOrder: PrismaWorkOrderDelegate;
  workOrderEquipmentArea: PrismaWorkOrderEquipmentAreaDelegate;
  location: { findMany: (args: unknown) => Promise<LocationRow[]> };
  $transaction: <T>(fn: (tx: PrismaTx) => Promise<T>) => Promise<T>;
};

function isLegacyArea(area: EquipmentAreaDb): area is LegacyEquipmentArea {
  return (LEGACY_AREAS as readonly string[]).includes(area);
}

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

/**
 * datetime-local submits "YYYY-MM-DDTHH:mm" with NO timezone.
 * We treat it as America/New_York wall time and convert to an absolute Date.
 */
function parseOptionalDateTimeLocal(v: FormDataEntryValue | null): Date | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(s);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const TZ = "America/New_York";

  function tzOffsetMinutes(at: Date, timeZone: string): number {
    // Offset in minutes where: localTime(timeZone) = UTC + offset
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(at);
    const get = (type: string) => {
      const p = parts.find((x) => x.type === type)?.value;
      return p ? Number(p) : NaN;
    };
    const y = get("year");
    const mo = get("month");
    const da = get("day");
    const h = get("hour");
    const mi = get("minute");
    const se = get("second");
    const asUTC = Date.UTC(y, mo - 1, da, h, mi, se);
    return Math.round((asUTC - at.getTime()) / 60000);
  }

  // Start with a UTC guess for the same wall-clock components, then shift by NY offset.
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(naiveUTC);
  const offsetMin = tzOffsetMinutes(guess, TZ);
  const out = new Date(naiveUTC - offsetMin * 60000);

  return Number.isNaN(out.getTime()) ? null : out;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

function fmtForDatetimeLocal(d: Date | null): string {
  if (!d) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(d));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  return `${y}-${mo}-${da}T${h}:${mi}`;
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

function statusLabel(s: WorkOrderStatus): string {
  if (s === "DRAFT") return "IN PROGRESS";
  if (s === "SUBMITTED") return "SUBMITTED";
  if (s === "FINALIZED") return "FINALIZED";
  return s;
}

function safeReturnToPathFromReferer(referer: string | null, fallback: string) {
  if (!referer) return fallback;
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : fallback;
  } catch {
    return fallback;
  }
}

export default async function AdminWorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getServerSession(authOptions)) as AdminSession;
  await requireAdmin(session);

  const { id } = await params;

  const [locations, workOrder] = await Promise.all([
    db.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.workOrder.findUnique({
      where: { id },
      include: {
        location: { select: { name: true } },
        equipmentAreas: true,
        createdByUser: { select: { name: true, email: true } },
        updatedByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  if (!workOrder) notFound();

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const soft = "rgba(255,255,255,0.03)";

  const shell: CSSProperties = { padding: 16, color: fg, maxWidth: 1100, margin: "0 auto" };
  const card: CSSProperties = { border, borderRadius: 12, padding: 12, background: surface };
  const label: CSSProperties = { display: "grid", gap: 4, fontSize: 12, opacity: 0.9 };
  const input: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border,
    background: surface,
    color: fg,
    outline: "none",
  };
  const btn: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
  };
  const gridWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 10,
    marginTop: 8,
  };
  const gridLabel: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border,
    borderRadius: 10,
    fontSize: 13,
    background: soft,
  };

  const selectedAreasDb = workOrder.equipmentAreas.map((a) => a.area);
  const hasLegacy = selectedAreasDb.some((a) => isLegacyArea(a));

  async function startNowAction() {
    "use server";
    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    await db.workOrder.update({
      where: { id },
      data: {
        startTime: new Date(),
      },
    });

    revalidatePath(`/admin/work-orders/${id}`);
    revalidatePath(`/admin/work-orders`);
    redirect(`/admin/work-orders/${id}`);
  }

  async function endNowAction() {
    "use server";
    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    await db.workOrder.update({
      where: { id },
      data: {
        endTime: new Date(),
      },
    });

    revalidatePath(`/admin/work-orders/${id}`);
    revalidatePath(`/admin/work-orders`);
    redirect(`/admin/work-orders/${id}`);
  }

  async function saveAction(formData: FormData) {
    "use server";
    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required");

    const statusRaw = String(formData.get("status") ?? "").trim().toUpperCase();
    const status: WorkOrderStatus | null = STATUSES.includes(statusRaw as WorkOrderStatus)
      ? (statusRaw as WorkOrderStatus)
      : null;
    if (!status) throw new Error("Invalid status");

    const notesRaw = String(formData.get("notes") ?? "");
    const notes = notesRaw.trim().length ? notesRaw : null;

    const startTime = parseOptionalDateTimeLocal(formData.get("startTime"));
    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));
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

    revalidatePath(`/admin/work-orders/${id}`);
    revalidatePath(`/admin/work-orders`);

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer"), `/admin/work-orders/${id}`));
  }

  async function deleteAction(formData: FormData) {
    "use server";
    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const confirmText = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirmText !== "DELETE") throw new Error('Type "DELETE" to confirm deletion.');

    await db.$transaction(async (tx) => {
      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
    });

    revalidatePath(`/admin/work-orders`);
    redirect(`/admin/work-orders`);
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={shell}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/admin/work-orders" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            ← Back
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Work Order</h1>
          <div style={{ opacity: 0.8, fontSize: 12 }}>id: {workOrder.id}</div>
        </div>

        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, opacity: 0.85 }}>
              <div>
                <b>Status:</b> {statusLabel(workOrder.status)}
              </div>
              <div>
                <b>Location:</b> {workOrder.location?.name ?? "—"}
              </div>
              <div>
                <b>Created:</b> {fmtLocal(workOrder.createdAt)}
              </div>
              <div>
                <b>Updated:</b> {fmtLocal(workOrder.updatedAt)}
              </div>
              <div>
                <b>Start/End:</b> {fmtLocal(workOrder.startTime)} → {fmtLocal(workOrder.endTime)}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <form action={startNowAction}>
                <button type="submit" style={btn}>
                  Start Now
                </button>
              </form>
              <form action={endNowAction}>
                <button type="submit" style={btn}>
                  End Now
                </button>
              </form>
            </div>

            {hasLegacy ? (
              <div style={{ marginTop: 6, padding: 10, border, borderRadius: 12, background: soft, fontSize: 12 }}>
                This work order contains <b>legacy</b> equipment area values. Saving will replace areas with only the
                current checkbox list.
              </div>
            ) : null}
          </div>
        </div>

        {/* EDIT FORM */}
        <div style={{ ...card, marginTop: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginTop: 0 }}>Edit</h2>

          <form action={saveAction} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={label}>
                Location
                <select name="locationId" defaultValue={workOrder.locationId} style={input}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={label}>
                Status
                <select name="status" defaultValue={workOrder.status} style={input}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label style={label}>
              Notes
              <textarea name="notes" defaultValue={workOrder.notes ?? ""} style={{ ...input, minHeight: 90 }} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={label}>
                Start Time
                <input
                  type="datetime-local"
                  name="startTime"
                  defaultValue={fmtForDatetimeLocal(workOrder.startTime)}
                  style={input}
                />
              </label>

              <label style={label}>
                End Time
                <input
                  type="datetime-local"
                  name="endTime"
                  defaultValue={fmtForDatetimeLocal(workOrder.endTime)}
                  style={input}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={label}>
                Starting Mileage
                <input type="number" name="startingMileage" defaultValue={workOrder.startingMileage ?? ""} style={input} />
              </label>

              <label style={label}>
                Ending Mileage
                <input type="number" name="endingMileage" defaultValue={workOrder.endingMileage ?? ""} style={input} />
              </label>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9 }}>Equipment Areas</div>
              <div style={gridWrap}>
                {EQUIPMENT_AREAS.map((area) => (
                  <label key={area} style={gridLabel}>
                    <input
                      type="checkbox"
                      name="areas"
                      value={area}
                      defaultChecked={selectedAreasDb.some((a) => a === area)}
                    />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatAreaLabel(area)}
                    </span>
                  </label>
                ))}
              </div>

              {/* Legacy display (read-only) */}
              {selectedAreasDb.some((a) => isLegacyArea(a)) ? (
                <div style={{ marginTop: 10, padding: 10, border, borderRadius: 12, background: soft, fontSize: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Legacy areas on this work order</div>
                  <div style={{ opacity: 0.9 }}>
                    {selectedAreasDb
                      .filter((a) => isLegacyArea(a))
                      .map((a) => formatAreaLabel(a))
                      .join(", ")}
                  </div>
                </div>
              ) : null}
            </div>

            <button type="submit" style={{ ...btn, width: 160 }}>
              Save Changes
            </button>
          </form>
        </div>

        {/* DELETE */}
        <div style={{ ...card, marginTop: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginTop: 0 }}>Delete</h2>
          <form action={deleteAction} style={{ display: "grid", gap: 10, maxWidth: 360 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Type <code>DELETE</code> to permanently delete this work order.
            </div>
            <input name="confirm" placeholder="DELETE" style={input} />
            <button type="submit" style={btn}>
              Permanently Delete
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
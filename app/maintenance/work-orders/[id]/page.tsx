// app/maintenance/work-orders/[id]/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { EquipmentArea, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

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

type WorkOrderStatus = "DRAFT" | "SUBMITTED" | "FINALIZED";

type RequiredEquipmentArea =
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

const EQUIPMENT_AREAS: RequiredEquipmentArea[] = [
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

function isLegacyArea(a: EquipmentArea): boolean {
  return (LEGACY_AREAS as readonly string[]).includes(String(a));
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

  // HTML <input type="datetime-local"> submits a string like "YYYY-MM-DDTHH:mm" with **no timezone**.
  // Node's Date parsing is not consistent across runtimes for this format, and server timezone can differ
  // from the user's. We treat these values as America/New_York wall time and convert to an absolute Date.
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

  // Start with a UTC guess for the same wall-clock components, then shift by the timezone offset.
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(naiveUTC);
  const offsetMin = tzOffsetMinutes(guess, TZ);
  const out = new Date(naiveUTC - offsetMin * 60000);
  return Number.isNaN(out.getTime()) ? null : out;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";

  // Render in business timezone for consistent UX regardless of server/runtime timezone.
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

  // datetime-local expects a value in *local wall time* (no timezone). We format in business timezone.
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

function formatAreaLabelWithLegacy(area: EquipmentArea): string {
  const label = formatAreaLabel(String(area));
  return isLegacyArea(area) ? `${label} (legacy)` : label;
}

function statusLabel(s: WorkOrderStatus): string {
  if (s === "DRAFT") return "IN PROGRESS";
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

export default async function MaintenanceWorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  const email = (session?.user?.email ?? "").toLowerCase().trim();
  const isAdmin = session?.user?.role === Role.ADMIN;

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
        select: {
          id: true,
          locationId: true,
          sortOrder: true,
          isPrimary: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const { id } = await params;

  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      locationId: true,
      location: { select: { name: true } },
      notes: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      createdByUserId: true,
      equipmentAreas: { select: { area: true } },
    },
  });

  if (!workOrder) notFound();

  // Regular users can only access their own work orders.
  if (!isAdmin && workOrder.createdByUserId !== me.id) redirect("/maintenance/work-orders");

  // Allowed locations: primary first, then optionals (dedup), preserving order.
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

  const selectedAreasDb: EquipmentArea[] = workOrder.equipmentAreas.map((a) => a.area);
  const hasLegacy = selectedAreasDb.some((a) => isLegacyArea(a));

  // Theme-variable styling (no hardcoded colors; just sizing/layout)
  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const soft = "rgba(255,255,255,0.03)";

  // Match main page width + bigger controls
  const shell: CSSProperties = { padding: 20, maxWidth: 1200, margin: "0 auto", color: fg };

  const card: CSSProperties = { border, borderRadius: 16, padding: 16, background: surface };

  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 14, opacity: 0.95, fontWeight: 800 };

  const input: CSSProperties = {
    padding: "12px 14px",
    borderRadius: 14,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 16,
    lineHeight: 1.25,
  };

  const btn: CSSProperties = {
    padding: "12px 16px",
    borderRadius: 14,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1.1,
  };

  const gridWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    marginTop: 10,
  };

  const gridItem: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    border,
    borderRadius: 14,
    background: soft,
    fontSize: 14,
    fontWeight: 800,
    minHeight: 44,
  };

  const checkbox: CSSProperties = { width: 18, height: 18 };

  async function startNowAction() {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const isAdmin = session?.user?.role === Role.ADMIN;

    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const wo = await prisma.workOrder.findUnique({ where: { id }, select: { createdByUserId: true } });
    if (!wo) notFound();
    if (!isAdmin && wo.createdByUserId !== me.id) redirect("/maintenance/work-orders");

    await prisma.workOrder.update({
      where: { id },
      data: { startTime: new Date(), updatedByUserId: me.id },
    });

    revalidatePath(`/maintenance/work-orders/${id}`);
    revalidatePath(`/maintenance/work-orders`);
    redirect(`/maintenance/work-orders/${id}`);
  }

  async function endNowAction() {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const isAdmin = session?.user?.role === Role.ADMIN;

    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const wo = await prisma.workOrder.findUnique({ where: { id }, select: { createdByUserId: true } });
    if (!wo) notFound();
    if (!isAdmin && wo.createdByUserId !== me.id) redirect("/maintenance/work-orders");

    await prisma.workOrder.update({
      where: { id },
      data: { endTime: new Date(), updatedByUserId: me.id },
    });

    revalidatePath(`/maintenance/work-orders/${id}`);
    revalidatePath(`/maintenance/work-orders`);
    redirect(`/maintenance/work-orders/${id}`);
  }

  async function saveAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const isAdmin = session?.user?.role === Role.ADMIN;

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

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: {
        createdByUserId: true,
        locationId: true,
      },
    });
    if (!wo) notFound();
    if (!isAdmin && wo.createdByUserId !== me.id) redirect("/maintenance/work-orders");

    const locationIdRaw = formData.get("locationId");
    const locationId = typeof locationIdRaw === "string" ? locationIdRaw : "";

    if (isAdmin) {
      // admin can set any locationId (validated by FK)
    } else {
      // regular user can only set their primary/allowed locations
      const allowed = new Set<string>();
      if (me.locationId) allowed.add(me.locationId);
      for (const a of me.allowedLocations) allowed.add(a.locationId);
      if (!allowed.has(locationId)) {
        throw new Error("Invalid location selection.");
      }
    }

    const statusRaw = formData.get("status");
    const status = typeof statusRaw === "string" ? statusRaw : "";
    if (!(STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");

    const notesRaw = formData.get("notes");
    const notes = typeof notesRaw === "string" ? notesRaw.trim() : "";
    const notesValue = notes.length > 0 ? notes : null;

    const startTime = parseOptionalDateTimeLocal(formData.get("startTime"));
    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));

    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));

    const areas = parseAreas(formData);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          locationId,
          status: status as any,
          notes: notesValue,
          startTime,
          endTime,
          startingMileage,
          endingMileage,
          updatedByUserId: me.id,
        },
      });

      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      if (areas.length > 0) {
        await tx.workOrderEquipmentArea.createMany({
          data: areas.map((area) => ({ workOrderId: id, area })),
        });
      }
    });

    revalidatePath(`/maintenance/work-orders/${id}`);
    revalidatePath(`/maintenance/work-orders`);
    revalidatePath(`/admin/work-orders`);

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer"), `/maintenance/work-orders/${id}`));
  }

  async function submitAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const email = (session?.user?.email ?? "").toLowerCase().trim();
    const isAdmin = session?.user?.role === Role.ADMIN;

    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { createdByUserId: true },
    });
    if (!wo) notFound();
    if (!isAdmin && wo.createdByUserId !== me.id) redirect("/maintenance/work-orders");

    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));
    if (!endTime) throw new Error("End time is required to submit.");
    if (endingMileage === null) throw new Error("Ending mileage is required to submit.");

    await prisma.workOrder.update({
      where: { id },
      data: {
        endTime,
        endingMileage,
        status: "SUBMITTED",
        updatedByUserId: me.id,
      },
    });

    revalidatePath(`/maintenance/work-orders/${id}`);
    revalidatePath(`/maintenance/work-orders`);
    revalidatePath(`/admin/work-orders`);
    redirect(`/maintenance/work-orders/${id}`);
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={shell}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/maintenance/work-orders" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            ← Back
          </Link>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Work Order</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>id: {workOrder.id}</div>
        </div>

        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 15, opacity: 0.85, display: "grid", gap: 6 }}>
              <div>
                <b>Status:</b> {statusLabel(workOrder.status as WorkOrderStatus)}
              </div>
              <div>
                <b>Location:</b> {workOrder.location?.name ?? "—"}
              </div>
              <div>
                <b>Created:</b> {fmtLocal(workOrder.createdAt)} • <b>Updated:</b> {fmtLocal(workOrder.updatedAt)}
              </div>
              <div>
                <b>Start/End:</b> {fmtLocal(workOrder.startTime)} → {fmtLocal(workOrder.endTime)}
              </div>
              <div>
                <b>Mileage:</b> {workOrder.startingMileage ?? "—"} → {workOrder.endingMileage ?? "—"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <form action={startNowAction}>
                <button type="submit" style={{ ...btn, minWidth: 190 }}>
                  Start Now
                </button>
              </form>

              <form action={endNowAction}>
                <button type="submit" style={{ ...btn, minWidth: 190 }}>
                  End Now
                </button>
              </form>

              <Link
                href={`/admin/work-orders/${workOrder.id}`}
                style={{
                  ...btn,
                  minWidth: 190,
                  textDecoration: "none",
                  display: isAdmin ? "inline-block" : "none",
                }}
              >
                Admin View
              </Link>
            </div>

            {hasLegacy ? (
              <div style={{ padding: 12, border, borderRadius: 14, background: soft, fontSize: 14 }}>
                This work order contains <b>legacy</b> equipment areas. Saving will replace areas using only the current
                checkbox list.
              </div>
            ) : null}
          </div>
        </div>

        {/* EDIT */}
        <div style={{ ...card, marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, marginTop: 0 }}>Edit</h2>

          <form action={saveAction} style={{ display: "grid", gap: 12 }}>
            <label style={label}>
              Location
              <select name="locationId" defaultValue={workOrder.locationId} style={input}>
                {isAdmin ? (
                  (await prisma.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })).map(
                    (l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    )
                  )
                ) : (
                  allowedLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.source === "PRIMARY" ? " (Primary)" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label style={label}>
              Status
              <select name="status" defaultValue={workOrder.status as string} style={input}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>

            <label style={label}>
              Notes
              <textarea name="notes" defaultValue={workOrder.notes ?? ""} style={{ ...input, minHeight: 160 }} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
              <div style={{ fontSize: 15, fontWeight: 900, opacity: 0.9 }}>Equipment Areas</div>
              <div style={gridWrap}>
                {EQUIPMENT_AREAS.map((area) => (
                  <label key={area} style={gridItem}>
                    <input
                      type="checkbox"
                      name="areas"
                      value={area}
                      defaultChecked={selectedAreasDb.some((a) => String(a) === area)}
                      style={checkbox}
                    />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatAreaLabel(area)}
                    </span>
                  </label>
                ))}
              </div>

              {selectedAreasDb.some((a) => isLegacyArea(a)) ? (
                <div style={{ marginTop: 12, padding: 12, border, borderRadius: 14, background: soft, fontSize: 14 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Legacy areas currently on this work order</div>
                  <div style={{ opacity: 0.9 }}>
                    {selectedAreasDb
                      .filter((a) => isLegacyArea(a))
                      .map((a) => formatAreaLabelWithLegacy(a))
                      .join(", ")}
                  </div>
                </div>
              ) : null}
            </div>

            <button type="submit" style={{ ...btn, width: 220 }}>
              Save
            </button>
          </form>
        </div>

        {/* SUBMIT */}
        <div style={{ ...card, marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, marginTop: 0 }}>Submit</h2>

          <form action={submitAction} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
            <div style={{ fontSize: 15, opacity: 0.85 }}>
              Submitting requires <b>End Time</b> and <b>Ending Mileage</b>. This marks status = <b>SUBMITTED</b>.
            </div>

            <label style={label}>
              End Time
              <input
                type="datetime-local"
                name="endTime"
                defaultValue={fmtForDatetimeLocal(workOrder.endTime)}
                style={input}
                required
              />
            </label>

            <label style={label}>
              Ending Mileage
              <input type="number" name="endingMileage" defaultValue={workOrder.endingMileage ?? ""} style={input} required />
            </label>

            <button type="submit" style={{ ...btn, width: 300 }}>
              Submit Work Order
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
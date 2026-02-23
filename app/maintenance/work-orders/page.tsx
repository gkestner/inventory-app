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

async function isEmployeeSession(session: SessionShape): Promise<boolean> {
  const role = (session?.user as { role?: Role | null } | undefined)?.role ?? null;
  if (role === Role.EMPLOYEE) return true;

  const email = (session?.user?.email ?? "").toLowerCase().trim();
  if (!email) return false;

  const me = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  return me?.role === Role.EMPLOYEE;
}

async function requireWorkOrdersView(session: SessionShape) {
  requireSession(session);

  if (await isEmployeeSession(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  if (!ok) redirect("/");
}

async function requireWorkOrdersCreate(session: SessionShape) {
  requireSession(session);

  if (await isEmployeeSession(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.CREATE_WORK_ORDERS]);
  if (!ok) redirect("/");
}

async function requireWorkOrdersSubmitOwn(session: SessionShape) {
  requireSession(session);

  if (await isEmployeeSession(session)) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.SUBMIT_OWN_WORK_ORDERS]);
  if (!ok) redirect("/");
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

function parseRequiredInt(v: FormDataEntryValue | null): number {
  const n = parseOptionalInt(v);
  if (n === null) throw new Error("Ending mileage is required.");
  return n;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
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

export default async function MaintenanceWorkOrdersPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  await requireWorkOrdersView(session);

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
    where: {
      createdByUserId: me.id,
      status: "DRAFT",
      endTime: null,
    },
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
      equipmentAreas: { select: { area: true } },
    },
  });

  /**
   * STYLE TUNING (requested)
   * - Larger base font
   * - Larger buttons
   * - Larger form controls
   * - Larger area chips
   * - Roomier table
   * - Top/bottom cards same width + centered
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

    // Enforce allowed location
    const allowed = new Set<string>();
    if (me.locationId) allowed.add(me.locationId);
    for (const ul of me.allowedLocations) allowed.add(ul.locationId);
    if (!allowed.has(locationId)) throw new Error("You are not allowed to create a work order for that location.");

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

    const endingMileage = parseRequiredInt(formData.get("endingMileage"));
    const notes = String(formData.get("notes") ?? "");
    const areas = parseAreas(formData);

    await prisma.$transaction(async (tx) => {
      // Ensure it still belongs to this user and is still open
      const wo = await tx.workOrder.findUnique({
        where: { id },
        select: { id: true, createdByUserId: true, status: true, endTime: true, startTime: true, startingMileage: true },
      });

      if (!wo) throw new Error("Work order not found");
      if (wo.createdByUserId !== me.id) throw new Error("Not allowed");
      if (wo.status !== "DRAFT" || wo.endTime) throw new Error("Work order is not in progress");

      if (typeof wo.startingMileage === "number" && endingMileage < wo.startingMileage) {
        throw new Error("Ending mileage cannot be less than starting mileage.");
      }

      await tx.workOrder.update({
        where: { id },
        data: {
          notes,
          endingMileage,
          endTime: new Date(), // End sets endTime
          status: "SUBMITTED", // End auto-submits
        },
      });

      // Replace areas atomically
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

  const inProgressChecked = new Set<string>(inProgress?.equipmentAreas?.map((x) => String(x.area)) ?? []);

  return (
    <main>
      <div style={shell}>
        <div style={pageWidth}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Maintenance: Work Orders</h1>
        </div>

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
                  End (sets End Time + Submit)
                </button>
              </form>
            </>
          )}
        </div>

        {/* BOTTOM CARD: Recent list */}
        <div style={{ ...card, ...pageWidth, marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Recent Work Orders</h2>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr>
                  {["When", "Location", "Status", "Areas", "Start", "End", "Mileage"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(128,128,128,0.25)",
                        fontSize: 13,
                        opacity: 0.85,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workOrders.map((w) => {
                  const mileageText =
                    typeof w.startingMileage === "number" || typeof w.endingMileage === "number"
                      ? `${w.startingMileage ?? "—"} → ${w.endingMileage ?? "—"}`
                      : "—";

                  const areas = (w.equipmentAreas ?? []).map((a) => String(a.area) as EquipmentAreaDb);

                  return (
                    <tr key={w.id}>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {fmtLocal(w.createdAt)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {w.location?.name ?? "—"}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)", fontWeight: 900 }}>
                        {statusLabel(w.status as WorkOrderStatus)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {areas.length ? areas.map(formatAreaLabelWithLegacy).join(", ") : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {fmtLocal(w.startTime)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {fmtLocal(w.endTime)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                        {mileageText}
                      </td>
                    </tr>
                  );
                })}

                {workOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: 12,
                        borderBottom: "1px solid rgba(128,128,128,0.15)",
                        opacity: 0.8,
                      }}
                    >
                      No work orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

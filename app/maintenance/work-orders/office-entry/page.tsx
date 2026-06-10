import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";
import WorkOrderEquipmentSelector from "@/app/components/WorkOrderEquipmentSelector";
import {
  WORK_ORDER_EQUIPMENT_AREAS,
  type WorkOrderChecklistTx,
  type WorkOrderEquipmentArea,
  formatWorkOrderEquipmentAreaLabel,
  groupChecklistItemsByArea,
  listChecklistItems,
  parseChecklistItemIds,
  parseWorkOrderEquipmentAreas,
  syncWorkOrderChecklistSelections,
} from "@/app/lib/work-order-equipment";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type WorkOrderStatus = "DRAFT" | "SUBMITTED";
type EquipmentArea = WorkOrderEquipmentArea;

const EQUIPMENT_AREAS: readonly EquipmentArea[] = WORK_ORDER_EQUIPMENT_AREAS;

async function requireOfficeEntryAccess(session: SessionShape) {
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  if (!hasAnyPermission(perms, [CREATE_WORK_ORDERS_FOR_OTHERS])) {
    redirect("/maintenance");
  }
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

function parseAreas(formData: FormData): EquipmentArea[] {
  return parseWorkOrderEquipmentAreas(formData);
}

function formatAreaLabel(area: string): string {
  return formatWorkOrderEquipmentAreaLabel(area);
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
  if (!d) return "-";
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

export default async function WorkOrderOfficeEntryPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  await requireOfficeEntryAccess(session);
  const checklistItemsByArea = groupChecklistItemsByArea(await listChecklistItems());

  async function createOfficeWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireOfficeEntryAccess(session);

    const actorEmail = (session?.user?.email ?? "").toLowerCase().trim();
    const actor = await prisma.user.findUnique({
      where: { email: actorEmail },
      select: { id: true, active: true },
    });
    if (!actor || !actor.active) redirect("/login");

    const createdByUserId = String(formData.get("createdByUserId") ?? "").trim();
    if (!createdByUserId) throw new Error("Technician user is required.");

    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!locationId) throw new Error("Location is required.");

    const statusRaw = String(formData.get("status") ?? "DRAFT").trim().toUpperCase();
    const status: WorkOrderStatus = statusRaw === "SUBMITTED" ? "SUBMITTED" : "DRAFT";

    const startTime = parseOptionalDateTimeLocal(formData.get("startTime"));
    const endTime = parseOptionalDateTimeLocal(formData.get("endTime"));
    const startingMileage = parseOptionalInt(formData.get("startingMileage"));
    const endingMileage = parseOptionalInt(formData.get("endingMileage"));
    const notes = String(formData.get("notes") ?? "");
    const areas = parseAreas(formData);
    const checklistItemIds = parseChecklistItemIds(formData);

    const targetUser = await prisma.user.findUnique({
      where: { id: createdByUserId },
      select: { id: true, active: true },
    });
    if (!targetUser || !targetUser.active) throw new Error("Selected technician is not active.");

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, active: true, receiptEnabled: true },
    });
    if (!location || !location.active || !location.receiptEnabled) throw new Error("Selected location is invalid.");

    if (!startTime) throw new Error("Start time is required.");

    if (status === "SUBMITTED") {
      if (!endTime) throw new Error("End time is required for pending work orders.");
      if (endingMileage === null) throw new Error("Ending mileage is required for pending work orders.");
      if (endTime.getTime() < startTime.getTime()) throw new Error("End time cannot be before start time.");
    }

    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          createdByUserId,
          updatedByUserId: actor.id,
          locationId,
          status,
          startTime,
          endTime: status === "SUBMITTED" ? endTime : null,
          startingMileage,
          endingMileage: status === "SUBMITTED" ? endingMileage : null,
          notes,
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
    });

    revalidatePath("/maintenance/work-orders/office-entry");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/admin/work-orders");
    redirect("/maintenance/work-orders/office-entry?saved=1");
  }

  const [users, locations, recent] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.workOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        createdAt: true,
        startTime: true,
        endTime: true,
        location: { select: { name: true } },
        createdByUser: { select: { name: true, email: true } },
        updatedByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const shell: CSSProperties = { padding: 20, display: "grid", gap: 14 };
  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 14,
    padding: 14,
    background: "var(--background)",
    color: "var(--foreground)",
  };
  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 800 };
  const input: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
  };
  const gridWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
    gap: 10,
    marginTop: 10,
  };
  const gridItem: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 10,
  };

  return (
    <main style={shell}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Work Orders: Office Entry</h1>
        <Link href="/maintenance/work-orders" style={{ ...btn, textDecoration: "none" }}>
          Back to Work Orders
        </Link>
      </div>

      <div style={{ ...card, fontSize: 14, opacity: 0.88 }}>
        Use this page to enter a work order from paper documentation on behalf of a technician.
        Times display in <b>{TZ}</b>.
      </div>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Create Work Order For Another User</h2>
        <form action={createOfficeWorkOrderAction} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={label}>
              Technician (required)
              <select name="createdByUserId" defaultValue={users[0]?.id ?? ""} style={input} required>
                <option value="">Select user</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>

            <label style={label}>
              Location (required)
              <select name="locationId" defaultValue={locations[0]?.id ?? ""} style={input} required>
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={label}>
              Status
              <select name="status" defaultValue="SUBMITTED" style={input}>
                <option value="SUBMITTED">PENDING</option>
                <option value="DRAFT">DRAFT</option>
              </select>
            </label>

            <label style={label}>
              Starting Mileage (optional)
              <input name="startingMileage" type="number" style={input} placeholder="e.g. 17480" />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={label}>
              Start Time (required)
              <input
                name="startTime"
                type="datetime-local"
                defaultValue={fmtForDatetimeLocal(new Date())}
                style={input}
                required
              />
            </label>

            <label style={label}>
              End Time (required for PENDING)
              <input name="endTime" type="datetime-local" defaultValue={fmtForDatetimeLocal(new Date())} style={input} />
            </label>
          </div>

          <label style={label}>
            Ending Mileage (required for PENDING)
            <input name="endingMileage" type="number" style={input} placeholder="e.g. 17530" />
          </label>

          <label style={label}>
            Notes
            <textarea name="notes" style={{ ...input, minHeight: 96 }} placeholder="Paper form notes..." />
          </label>

          <div>
            <WorkOrderEquipmentSelector
              title="Equipment Areas (optional)"
              templatesByArea={checklistItemsByArea}
              helperText="Office entry can assign both the high-level area and any detailed checklist items completed on the paper form."
            />
          </div>

          <button type="submit" style={{ ...btn, width: 340 }}>
            Save Work Order (Office Entry)
          </button>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Recent Entries</h2>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Created",
                  "Status",
                  "Technician",
                  "Location",
                  "Start/End",
                  "Last Updated By",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{ textAlign: "left", borderBottom: "1px solid rgba(128,128,128,0.25)", padding: "8px 10px", fontSize: 12 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((wo) => (
                <tr key={wo.id}>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>{fmtLocal(wo.createdAt)}</td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px", fontWeight: 900 }}>{wo.status}</td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>
                    {wo.createdByUser ? `${wo.createdByUser.name} (${wo.createdByUser.email})` : "-"}
                  </td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>{wo.location?.name ?? "-"}</td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>
                    {fmtLocal(wo.startTime)} {"->"} {fmtLocal(wo.endTime)}
                  </td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>
                    {wo.updatedByUser ? `${wo.updatedByUser.name} (${wo.updatedByUser.email})` : "-"}
                  </td>
                  <td style={{ borderBottom: "1px solid rgba(128,128,128,0.18)", padding: "10px" }}>
                    <Link href={`/admin/work-orders/${wo.id}`} style={{ ...btn, textDecoration: "none", padding: "7px 10px", fontSize: 12 }}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}

              {recent.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, opacity: 0.8 }}>
                    No work orders yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

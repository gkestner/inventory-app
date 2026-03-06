import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import {
  evaluateVehicleReminder,
  fmtDateTimeLocalInput,
  parseOptionalDateTimeLocal,
  parseOptionalDecimal,
  parseOptionalInt,
  resolveVehicleCurrentMileageMap,
  type CompanyVehicleLite,
  type VehicleReminderLite,
} from "@/app/lib/company-vehicles";

export const dynamic = "force-dynamic";

type UserLite = { id: string; name: string | null; email: string | null; role: string };
type VehicleRow = CompanyVehicleLite & { assignedUser: { id: string; name: string | null; email: string | null } | null };
type ReminderRow = VehicleReminderLite & { vehicle: { id: string; name: string } };
type ServiceRow = {
  id: string;
  serviceAt: Date;
  serviceType: string | null;
  odometer: number | null;
  description: string;
  vendor: string | null;
  cost: unknown;
  vehicle: { id: string; name: string; vinNumber: string | null };
  performedByUser: { name: string | null; email: string | null } | null;
};

type Db = {
  user: { findUnique: (args: unknown) => Promise<{ id: string; active: boolean } | null>; findMany: (args: unknown) => Promise<UserLite[]> };
  companyVehicle: {
    findMany: (args: unknown) => Promise<VehicleRow[]>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
  vehicleMaintenanceReminder: {
    findMany: (args: unknown) => Promise<ReminderRow[]>;
    create: (args: unknown) => Promise<{ id: string }>;
    update: (args: unknown) => Promise<unknown>;
  };
  companyVehicleServiceLog: {
    create: (args: unknown) => Promise<{ id: string }>;
    findMany: (args: unknown) => Promise<ServiceRow[]>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

async function requireAdminAccess(session: unknown) {
  if (!session) redirect("/login");
  const allowed = await canAccessAdmin(session);
  if (!allowed) redirect("/");
}

function fmtLocal(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function formatCost(v: unknown): string {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `$${n.toFixed(2)}`;
}

export default async function AdminCompanyVehiclesPage() {
  const session = await getServerSession(authOptions);
  await requireAdminAccess(session);

  async function createVehicleAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireAdminAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const name = String(formData.get("name") ?? "").trim();
    const vinNumber = String(formData.get("vinNumber") ?? "").trim() || null;
    const licensePlate = String(formData.get("licensePlate") ?? "").trim() || null;
    const assignedUserId = String(formData.get("assignedUserId") ?? "").trim() || null;
    const mileageSource = String(formData.get("mileageSource") ?? "MANUAL").trim();
    const currentMileage = parseOptionalInt(formData.get("currentMileage"));
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!name) throw new Error("Vehicle name is required.");
    if (mileageSource !== "MANUAL" && mileageSource !== "WORK_ORDERS_BY_ASSIGNED_USER") {
      throw new Error("Invalid mileage source.");
    }

    const created = await db.companyVehicle.create({
      data: {
        name,
        vinNumber,
        licensePlate,
        assignedUserId,
        mileageSource,
        currentMileage,
        notes,
        active: true,
      },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "COMPANY_VEHICLES",
        action: "CREATE_VEHICLE",
        entityType: "CompanyVehicle",
        entityId: created.id,
        message: `Created company vehicle ${name}.`,
      },
    });

    revalidatePath("/admin/company-vehicles");
    revalidatePath("/maintenance/vehicle-log");
  }

  async function createReminderAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireAdminAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const vehicleId = String(formData.get("vehicleId") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const reminderType = String(formData.get("reminderType") ?? "TIME_BASED").trim();
    const intervalDays = parseOptionalInt(formData.get("intervalDays"));
    const intervalMiles = parseOptionalInt(formData.get("intervalMiles"));

    if (!vehicleId) throw new Error("Vehicle is required.");
    if (!title) throw new Error("Reminder title is required.");
    if (reminderType !== "TIME_BASED" && reminderType !== "MILEAGE_BASED") throw new Error("Invalid reminder type.");
    if (reminderType === "TIME_BASED" && (!intervalDays || intervalDays <= 0)) {
      throw new Error("Time reminders require interval days.");
    }
    if (reminderType === "MILEAGE_BASED" && (!intervalMiles || intervalMiles <= 0)) {
      throw new Error("Mileage reminders require interval miles.");
    }

    const created = await db.vehicleMaintenanceReminder.create({
      data: {
        vehicleId,
        title,
        description,
        reminderType,
        intervalDays: reminderType === "TIME_BASED" ? intervalDays : null,
        intervalMiles: reminderType === "MILEAGE_BASED" ? intervalMiles : null,
        createdByUserId: actor.id,
        updatedByUserId: actor.id,
        active: true,
      },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "COMPANY_VEHICLES",
        action: "CREATE_REMINDER",
        entityType: "VehicleMaintenanceReminder",
        entityId: created.id,
        message: `Created vehicle reminder ${title}.`,
      },
    });

    revalidatePath("/admin/company-vehicles");
  }

  async function createServiceLogAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireAdminAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const vehicleId = String(formData.get("vehicleId") ?? "").trim();
    const reminderId = String(formData.get("reminderId") ?? "").trim() || null;
    const serviceAt = parseOptionalDateTimeLocal(formData.get("serviceAt")) ?? new Date();
    const odometer = parseOptionalInt(formData.get("odometer"));
    const serviceType = String(formData.get("serviceType") ?? "").trim() || null;
    const description = String(formData.get("description") ?? "").trim();
    const vendor = String(formData.get("vendor") ?? "").trim() || null;
    const cost = parseOptionalDecimal(formData.get("cost"));
    const performedByUserId = String(formData.get("performedByUserId") ?? "").trim() || null;

    if (!vehicleId) throw new Error("Vehicle is required.");
    if (!description) throw new Error("Description is required.");

    const created = await db.companyVehicleServiceLog.create({
      data: {
        vehicleId,
        reminderId,
        serviceAt,
        odometer,
        serviceType,
        description,
        vendor,
        cost,
        performedByUserId,
        createdByUserId: actor.id,
      },
      select: { id: true },
    });

    if (reminderId) {
      await db.vehicleMaintenanceReminder.update({
        where: { id: reminderId },
        data: {
          lastCompletedAt: serviceAt,
          lastCompletedMileage: odometer,
          updatedByUserId: actor.id,
        },
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "COMPANY_VEHICLES",
        action: "CREATE_SERVICE_LOG",
        entityType: "CompanyVehicleServiceLog",
        entityId: created.id,
        message: "Created company vehicle service log.",
      },
    });

    revalidatePath("/admin/company-vehicles");
    revalidatePath("/maintenance/vehicle-log");
  }

  const [users, vehiclesRaw, remindersRaw, recentLogs] = await Promise.all([
    db.user.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
    db.companyVehicle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        vinNumber: true,
        licensePlate: true,
        active: true,
        mileageSource: true,
        currentMileage: true,
        assignedUserId: true,
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    }),
    db.vehicleMaintenanceReminder.findMany({
      where: { active: true },
      orderBy: [{ vehicle: { name: "asc" } }, { title: "asc" }],
      select: {
        id: true,
        vehicleId: true,
        title: true,
        description: true,
        reminderType: true,
        intervalDays: true,
        intervalMiles: true,
        lastCompletedAt: true,
        lastCompletedMileage: true,
        active: true,
        vehicle: { select: { id: true, name: true } },
      },
    }),
    db.companyVehicleServiceLog.findMany({
      orderBy: { serviceAt: "desc" },
      take: 40,
      select: {
        id: true,
        serviceAt: true,
        serviceType: true,
        odometer: true,
        description: true,
        vendor: true,
        cost: true,
        vehicle: { select: { id: true, name: true, vinNumber: true } },
        performedByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const vehicles: CompanyVehicleLite[] = vehiclesRaw.map((v) => ({
    id: v.id,
    name: v.name,
    vinNumber: v.vinNumber,
    licensePlate: v.licensePlate,
    active: v.active,
    mileageSource: v.mileageSource as "MANUAL" | "WORK_ORDERS_BY_ASSIGNED_USER",
    currentMileage: v.currentMileage,
    assignedUserId: v.assignedUserId,
  }));

  const reminderRows: VehicleReminderLite[] = remindersRaw.map((r) => ({
    id: r.id,
    vehicleId: r.vehicleId,
    title: r.title,
    description: r.description,
    reminderType: r.reminderType as "TIME_BASED" | "MILEAGE_BASED",
    intervalDays: r.intervalDays,
    intervalMiles: r.intervalMiles,
    lastCompletedAt: r.lastCompletedAt,
    lastCompletedMileage: r.lastCompletedMileage,
    active: r.active,
  }));

  const mileageMap = await resolveVehicleCurrentMileageMap(vehicles);
  const now = new Date();

  const dueRows = reminderRows
    .map((r) => {
      const vehicle = vehicles.find((v) => v.id === r.vehicleId);
      if (!vehicle) return null;
      return evaluateVehicleReminder({ reminder: r, vehicle, currentMileage: mileageMap.get(vehicle.id) ?? null, now });
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(b.due) - Number(a.due) || a.vehicleName.localeCompare(b.vehicleName));

  const nowInput = fmtDateTimeLocalInput(new Date());

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
  };

  const input: CSSProperties = {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface)",
    color: "var(--foreground)",
  };

  const btn: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <section
        style={{
          ...card,
          background:
            "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 70%)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Company Vehicles</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Manage vehicles, create maintenance reminders by mileage or time, and keep a full service log with audit trail.
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <Link href="/admin" style={btn}>
            Back to Admin Hub
          </Link>
          <Link href="/maintenance/vehicle-log" style={btn}>
            Open Maintenance Quick Log
          </Link>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Create Vehicle</h2>
        <form action={createVehicleAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input name="name" placeholder="Vehicle name" style={input} required />
            <input name="vinNumber" placeholder="VIN number" style={input} />
            <input name="licensePlate" placeholder="License plate" style={input} />
            <select name="assignedUserId" style={input}>
              <option value="">Assigned user (optional)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name ?? "").trim() || (u.email ?? "").trim()}
                </option>
              ))}
            </select>
            <select name="mileageSource" style={input} defaultValue="MANUAL">
              <option value="MANUAL">Manual Mileage</option>
              <option value="WORK_ORDERS_BY_ASSIGNED_USER">From Assigned User Work Orders/Travel</option>
            </select>
            <input name="currentMileage" type="number" placeholder="Current mileage" style={input} />
          </div>
          <textarea name="notes" placeholder="Notes (optional)" style={{ ...input, minHeight: 80 }} />
          <div>
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Create Vehicle
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Create Reminder</h2>
        <form action={createReminderAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <select name="vehicleId" style={input} required>
              <option value="">Select vehicle</option>
              {vehiclesRaw.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.vinNumber ? ` (VIN: ${v.vinNumber})` : ""}
                </option>
              ))}
            </select>
            <input name="title" placeholder="Reminder title" style={input} required />
            <select name="reminderType" defaultValue="TIME_BASED" style={input}>
              <option value="TIME_BASED">Time Based</option>
              <option value="MILEAGE_BASED">Mileage Based</option>
            </select>
            <input type="number" name="intervalDays" placeholder="Interval days (time-based)" style={input} />
            <input type="number" name="intervalMiles" placeholder="Interval miles (mileage-based)" style={input} />
          </div>
          <textarea name="description" placeholder="Description (optional)" style={{ ...input, minHeight: 80 }} />
          <div>
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Create Reminder
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Quick Service Log</h2>
        <form action={createServiceLogAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <select name="vehicleId" style={input} required>
              <option value="">Select vehicle</option>
              {vehiclesRaw.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.vinNumber ? ` (VIN: ${v.vinNumber})` : ""}
                </option>
              ))}
            </select>
            <input name="serviceAt" type="datetime-local" defaultValue={nowInput} style={input} />
            <input name="odometer" type="number" placeholder="Odometer" style={input} />
            <input name="serviceType" placeholder="Service type" style={input} />
            <input name="vendor" placeholder="Vendor" style={input} />
            <input name="cost" type="number" step="0.01" placeholder="Cost" style={input} />
            <select name="performedByUserId" style={input}>
              <option value="">Performed by (optional)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name ?? "").trim() || (u.email ?? "").trim()}
                </option>
              ))}
            </select>
            <select name="reminderId" style={input}>
              <option value="">Mark reminder completed (optional)</option>
              {remindersRaw.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.vehicle.name}: {r.title}
                </option>
              ))}
            </select>
          </div>
          <textarea name="description" placeholder="What was done" required style={{ ...input, minHeight: 90 }} />
          <div>
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Save Service Log
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Reminder Status</h2>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Vehicle", "Reminder", "Type", "Current Mileage", "Next Due", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dueRows.map((r) => (
                <tr key={r.reminderId}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.vehicleName}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.title}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.reminderType === "TIME_BASED" ? "Time" : "Mileage"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.currentMileage ?? "-"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {r.reminderType === "MILEAGE_BASED"
                      ? r.nextDueMileage ?? "-"
                      : r.nextDueDate
                        ? fmtLocal(r.nextDueDate)
                        : "-"}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 900, color: r.due ? "#b42318" : "inherit" }}>
                    {r.due ? "DUE" : r.reminderType === "MILEAGE_BASED" ? `${r.milesRemaining ?? 0} miles left` : `${r.daysRemaining ?? 0} days left`}
                  </td>
                </tr>
              ))}
              {dueRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, opacity: 0.75 }}>
                    No reminders configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Recent Company Vehicle Service Logs</h2>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Date", "Vehicle", "Type", "Odometer", "Vendor", "Cost", "Performed By", "Description"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{fmtLocal(r.serviceAt)}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.vehicle.name}{r.vehicle.vinNumber ? ` (VIN: ${r.vehicle.vinNumber})` : ""}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.serviceType ?? "General"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.odometer ?? "-"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.vendor ?? "-"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{formatCost(r.cost)}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {(r.performedByUser?.name ?? "").trim() || (r.performedByUser?.email ?? "").trim() || "-"}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.description}</td>
                </tr>
              ))}
              {recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 12, opacity: 0.75 }}>
                    No service logs yet.
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

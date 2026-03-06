import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";
import {
  fmtDateTimeLocalInput,
  parseOptionalDateTimeLocal,
  parseOptionalDecimal,
  parseOptionalInt,
} from "@/app/lib/company-vehicles";

export const dynamic = "force-dynamic";

type Vehicle = { id: string; name: string; unitNumber: string | null; active: boolean };
type Reminder = { id: string; vehicleId: string; title: string; active: boolean };
type ServiceRow = {
  id: string;
  serviceAt: Date;
  odometer: number | null;
  serviceType: string | null;
  description: string;
  vehicle: { name: string; unitNumber: string | null };
};

type Db = {
  companyVehicle: {
    findMany: (args: unknown) => Promise<Vehicle[]>;
  };
  vehicleMaintenanceReminder: {
    findMany: (args: unknown) => Promise<Reminder[]>;
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

async function requireMaintenanceAreaAccess(session: unknown) {
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  const ok =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_LIVE_ORDERS,
    ]);
  if (!ok) redirect("/");
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

export default async function MaintenanceVehicleLogPage() {
  const session = await getServerSession(authOptions);
  await requireMaintenanceAreaAccess(session);

  const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/login");

  const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
  if (!me || !me.active) redirect("/login");

  async function createVehicleServiceEntryAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireMaintenanceAreaAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) redirect("/login");

    const me = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!me || !me.active) redirect("/login");

    const vehicleId = String(formData.get("vehicleId") ?? "").trim();
    if (!vehicleId) throw new Error("Vehicle is required.");

    const serviceAt = parseOptionalDateTimeLocal(formData.get("serviceAt")) ?? new Date();
    const odometer = parseOptionalInt(formData.get("odometer"));
    const description = String(formData.get("description") ?? "").trim();
    const serviceType = String(formData.get("serviceType") ?? "").trim() || null;
    const vendor = String(formData.get("vendor") ?? "").trim() || null;
    const cost = parseOptionalDecimal(formData.get("cost"));
    const reminderId = String(formData.get("reminderId") ?? "").trim() || null;

    if (!description) throw new Error("Please describe the work performed.");

    const saved = await db.companyVehicleServiceLog.create({
      data: {
        vehicleId,
        reminderId,
        serviceAt,
        odometer,
        serviceType,
        description,
        vendor,
        cost,
        performedByUserId: me.id,
        createdByUserId: me.id,
      },
      select: { id: true },
    });

    if (reminderId) {
      await db.vehicleMaintenanceReminder.update({
        where: { id: reminderId },
        data: {
          lastCompletedAt: serviceAt,
          lastCompletedMileage: odometer,
          updatedByUserId: me.id,
        },
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: me.id,
        module: "COMPANY_VEHICLES",
        action: "CREATE_SERVICE_LOG",
        entityType: "CompanyVehicleServiceLog",
        entityId: saved.id,
        message: "Created company vehicle maintenance log entry.",
        metadata: {
          vehicleId,
          reminderId,
          serviceAt,
          odometer,
          serviceType,
          description,
        },
      },
    });

    revalidatePath("/maintenance/vehicle-log");
    revalidatePath("/admin/company-vehicles");
  }

  const [vehicles, reminders, recentMine] = await Promise.all([
    db.companyVehicle.findMany({
      where: { active: true, NOT: [{ name: "Office" }, { name: "office" }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unitNumber: true, active: true },
    }),
    db.vehicleMaintenanceReminder.findMany({
      where: { active: true },
      orderBy: [{ vehicle: { name: "asc" } }, { title: "asc" }],
      select: { id: true, vehicleId: true, title: true, active: true },
    }),
    db.companyVehicleServiceLog.findMany({
      where: { performedByUserId: me.id },
      orderBy: { serviceAt: "desc" },
      take: 20,
      select: {
        id: true,
        serviceAt: true,
        odometer: true,
        serviceType: true,
        description: true,
        vehicle: { select: { name: true, unitNumber: true } },
      },
    }),
  ]);

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
    whiteSpace: "nowrap",
    textDecoration: "none",
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Vehicle Maintenance Log</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Quick entry form for maintenance technicians to log work done on company vehicles.
        </p>
        <div style={{ marginTop: 10 }}>
          <Link href="/maintenance" style={btn}>
            Back to Maintenance Hub
          </Link>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>New Entry</h2>
        <form action={createVehicleServiceEntryAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Vehicle</div>
              <select name="vehicleId" style={input} required>
                <option value="">Select vehicle</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.unitNumber ? ` (${v.unitNumber})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Service Time</div>
              <input type="datetime-local" name="serviceAt" defaultValue={nowInput} style={input} />
            </label>

            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Odometer (optional)</div>
              <input type="number" name="odometer" style={input} />
            </label>

            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Service Type</div>
              <select name="serviceType" style={input}>
                <option value="">General</option>
                <option value="PM">PM</option>
                <option value="Repair">Repair</option>
                <option value="Inspection">Inspection</option>
                <option value="Oil Change">Oil Change</option>
                <option value="Tires">Tires</option>
              </select>
            </label>
          </div>

          <label>
            <div style={{ fontWeight: 800, fontSize: 13 }}>What was done</div>
            <textarea name="description" style={{ ...input, minHeight: 110 }} required />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Vendor/Shop (optional)</div>
              <input name="vendor" style={input} />
            </label>

            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Cost (optional)</div>
              <input type="number" step="0.01" name="cost" style={input} />
            </label>

            <label>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Mark Reminder Completed (optional)</div>
              <select name="reminderId" style={input}>
                <option value="">No reminder</option>
                {reminders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Save Vehicle Log Entry
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>My Recent Entries</h2>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {[
                  "Date",
                  "Vehicle",
                  "Type",
                  "Odometer",
                  "Description",
                ].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentMine.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{fmtLocal(r.serviceAt)}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    {r.vehicle.name}{r.vehicle.unitNumber ? ` (${r.vehicle.unitNumber})` : ""}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.serviceType ?? "General"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.odometer ?? "-"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{r.description}</td>
                </tr>
              ))}
              {recentMine.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.75 }}>
                    No entries yet.
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

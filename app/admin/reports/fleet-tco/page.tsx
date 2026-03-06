import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_COMPANY_VEHICLES } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  days?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type VehicleRow = {
  id: string;
  name: string;
  vinNumber: string | null;
  assignedUser: { name: string | null; email: string | null } | null;
  serviceLogs: Array<{ id: string; serviceAt: Date; odometer: number | null; cost: unknown }>;
  reminders: Array<{ id: string; title: string; lastCompletedAt: Date | null }>;
};

type Db = {
  companyVehicle: {
    findMany: (args: unknown) => Promise<VehicleRow[]>;
  };
};

const db = prisma as unknown as Db;

function parseNum(v: string | undefined, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES])) {
    redirect("/");
  }
}

export default async function FleetTcoReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const days = Math.min(730, parseNum(sp.days, 180));
  const exportHref = `/api/admin/reports/fleet-tco/export?days=${encodeURIComponent(String(days))}`;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const vehicles = await db.companyVehicle.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      vinNumber: true,
      assignedUser: { select: { name: true, email: true } },
      serviceLogs: {
        where: { serviceAt: { gte: since } },
        select: { id: true, serviceAt: true, odometer: true, cost: true },
      },
      reminders: {
        where: { active: true },
        select: { id: true, title: true, lastCompletedAt: true },
      },
    },
  });

  const rows = vehicles.map((v) => {
    const costs = v.serviceLogs.reduce((sum, r) => sum + Number(r.cost ?? 0), 0);
    const mileage = v.serviceLogs.map((r) => r.odometer).filter((m): m is number => typeof m === "number");
    const minMileage = mileage.length > 0 ? Math.min(...mileage) : null;
    const maxMileage = mileage.length > 0 ? Math.max(...mileage) : null;
    const delta = minMileage != null && maxMileage != null && maxMileage >= minMileage ? maxMileage - minMileage : 0;
    const costPerMile = delta > 0 ? costs / delta : null;
    const completedReminders = v.reminders.filter((r) => r.lastCompletedAt && r.lastCompletedAt >= since).length;
    const assignee = (v.assignedUser?.name ?? "").trim() || (v.assignedUser?.email ?? "").trim() || "Unassigned";

    return {
      id: v.id,
      name: v.name,
      vin: v.vinNumber ?? "",
      assignee,
      serviceCount: v.serviceLogs.length,
      costs,
      delta,
      costPerMile,
      remindersActive: v.reminders.length,
      remindersCompleted: completedReminders,
    };
  });

  rows.sort((a, b) => b.costs - a.costs);

  const totalCost = rows.reduce((sum, r) => sum + r.costs, 0);
  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Fleet TCO Report</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
            <Link href={exportHref} style={{ textDecoration: "none", fontWeight: 800 }}>
              Export CSV
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Service spend and mileage movement for active company vehicles in the selected period.
          </p>
        </section>

        <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            Window (days)
            <input type="number" min={30} max={730} name="days" defaultValue={String(days)} />
          </label>
          <button type="submit" style={{ padding: "9px 12px", borderRadius: 10, border, fontWeight: 800 }}>
            Run Report
          </button>
        </form>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Active Vehicles</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{rows.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Total Service Cost</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>${totalCost.toFixed(2)}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Vehicle", "VIN", "Assigned", "Service Logs", "Cost", "Miles Delta", "Cost/Mile", "Reminders Done/Active"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.name}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.vin || "-"}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.assignee}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.serviceCount}</td>
                  <td style={{ padding: 10, borderBottom: border }}>${r.costs.toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.delta}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.costPerMile == null ? "-" : `$${r.costPerMile.toFixed(3)}`}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.remindersCompleted} / {r.remindersActive}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "var(--muted)" }}>
                    No active vehicles found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

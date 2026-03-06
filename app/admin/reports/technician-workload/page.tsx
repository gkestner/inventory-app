import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_MAINTENANCE_REQUESTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  days?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type RequestRow = {
  id: string;
  status: "OPEN" | "RESOLVED" | "ARCHIVED";
  assignedMaintenanceUser: { name: string | null; email: string | null } | null;
  resolvedAt: Date | null;
  archivedAt: Date | null;
};

type WorkOrderRow = {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "FINALIZED";
  createdByUser: { name: string | null; email: string | null };
};

type Db = {
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<RequestRow[]>;
  };
  workOrder: {
    findMany: (args: unknown) => Promise<WorkOrderRow[]>;
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
  const canRequests = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  const canWorkOrders =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);

  if (!canRequests && !canWorkOrders) redirect("/");
}

export default async function TechnicianWorkloadReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const days = Math.min(365, parseNum(sp.days, 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [requestRows, workOrderRows] = await Promise.all([
    db.maintenanceRequest.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        status: true,
        assignedMaintenanceUser: { select: { name: true, email: true } },
        resolvedAt: true,
        archivedAt: true,
      },
      take: 3000,
    }),
    db.workOrder.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        status: true,
        createdByUser: { select: { name: true, email: true } },
      },
      take: 3000,
    }),
  ]);

  const bucket = new Map<
    string,
    {
      name: string;
      requestOpen: number;
      requestClosed: number;
      workOrderOpen: number;
      workOrderClosed: number;
    }
  >();

  function useBucket(name: string) {
    const existing = bucket.get(name);
    if (existing) return existing;
    const created = { name, requestOpen: 0, requestClosed: 0, workOrderOpen: 0, workOrderClosed: 0 };
    bucket.set(name, created);
    return created;
  }

  for (const r of requestRows) {
    const tech = (r.assignedMaintenanceUser?.name ?? "").trim() || (r.assignedMaintenanceUser?.email ?? "").trim() || "Unassigned";
    const b = useBucket(tech);
    const closed = !!(r.resolvedAt || r.archivedAt || r.status !== "OPEN");
    if (closed) b.requestClosed += 1;
    else b.requestOpen += 1;
  }

  for (const r of workOrderRows) {
    const tech = (r.createdByUser?.name ?? "").trim() || (r.createdByUser?.email ?? "").trim() || "Unknown";
    const b = useBucket(tech);
    const closed = r.status === "SUBMITTED" || r.status === "FINALIZED";
    if (closed) b.workOrderClosed += 1;
    else b.workOrderOpen += 1;
  }

  const rows = Array.from(bucket.values())
    .map((r) => ({ ...r, openTotal: r.requestOpen + r.workOrderOpen, closedTotal: r.requestClosed + r.workOrderClosed }))
    .sort((a, b) => b.openTotal - a.openTotal || b.closedTotal - a.closedTotal);

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Technician Workload + Throughput</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Open load and close-throughput by tech for the selected time window.
          </p>
        </section>

        <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            Window (days)
            <input type="number" min={1} max={365} name="days" defaultValue={String(days)} />
          </label>
          <button type="submit" style={{ padding: "9px 12px", borderRadius: 10, border, fontWeight: 800 }}>
            Run Report
          </button>
        </form>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Technician", "Req Open", "Req Closed", "WO Open", "WO Closed", "Open Total", "Closed Total"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.name}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.requestOpen}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.requestClosed}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.workOrderOpen}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.workOrderClosed}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.openTotal}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.closedTotal}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: "var(--muted)" }}>
                    No activity found in the selected window.
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

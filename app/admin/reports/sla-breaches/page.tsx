import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_MAINTENANCE_REQUESTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  days?: string;
  responseHours?: string;
  closeHours?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type RequestRow = {
  id: string;
  title: string;
  status: "OPEN" | "RESOLVED" | "ARCHIVED";
  createdAt: Date;
  resolvedAt: Date | null;
  archivedAt: Date | null;
  location: { name: string };
  assignedMaintenanceUser: { name: string | null; email: string | null } | null;
  requestedByUser: { name: string | null; email: string | null };
};

type Db = {
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<RequestRow[]>;
  };
};

const db = prisma as unknown as Db;

function parseNum(v: string | undefined, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60));
}

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS])) {
    redirect("/");
  }
}

export default async function SlaBreachesReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const days = Math.min(365, parseNum(sp.days, 30));
  const responseHours = parseNum(sp.responseHours, 4);
  const closeHours = parseNum(sp.closeHours, 48);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.maintenanceRequest.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      archivedAt: true,
      location: { select: { name: true } },
      assignedMaintenanceUser: { select: { name: true, email: true } },
      requestedByUser: { select: { name: true, email: true } },
    },
  });

  const now = new Date();

  const computed = rows.map((r) => {
    const end = r.resolvedAt ?? r.archivedAt ?? now;
    const ageHours = hoursBetween(r.createdAt, end);
    const isOpen = r.status === "OPEN";

    const responseBreached = isOpen && ageHours > responseHours;
    const closeBreached = !isOpen && ageHours > closeHours;

    return {
      ...r,
      ageHours,
      responseBreached,
      closeBreached,
      isOpen,
    };
  });

  const responseBreaches = computed.filter((r) => r.responseBreached);
  const closeBreaches = computed.filter((r) => r.closeBreached);
  const allBreaches = computed
    .filter((r) => r.responseBreached || r.closeBreached)
    .sort((a, b) => b.ageHours - a.ageHours)
    .slice(0, 300);

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>SLA Breach Monitor</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
            Tracks overdue response windows for open requests and long close durations for completed requests.
          </p>
        </section>

        <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <label>
              Window (days)
              <input type="number" min={1} max={365} name="days" defaultValue={String(days)} style={{ width: "100%" }} />
            </label>
            <label>
              Response SLA (hours)
              <input type="number" min={1} name="responseHours" defaultValue={String(responseHours)} style={{ width: "100%" }} />
            </label>
            <label>
              Close SLA (hours)
              <input type="number" min={1} name="closeHours" defaultValue={String(closeHours)} style={{ width: "100%" }} />
            </label>
          </div>
          <button type="submit" style={{ width: 180, padding: "9px 12px", borderRadius: 10, border, fontWeight: 800 }}>
            Run Report
          </button>
        </form>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Requests Checked</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{computed.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Open Response Breaches</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{responseBreaches.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Close-Time Breaches</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{closeBreaches.length}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Type", "Hours", "Status", "Location", "Assigned", "Title", "Requested By", "Created"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allBreaches.map((r) => {
                const assigned = (r.assignedMaintenanceUser?.name ?? "").trim() || (r.assignedMaintenanceUser?.email ?? "").trim() || "Unassigned";
                const requester = (r.requestedByUser?.name ?? "").trim() || (r.requestedByUser?.email ?? "").trim() || "Unknown";
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>
                      {r.responseBreached ? "Response" : "Close"}
                    </td>
                    <td style={{ padding: 10, borderBottom: border }}>{r.ageHours.toFixed(1)}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{r.status}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{r.location.name}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{assigned}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{r.title}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{requester}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{r.createdAt.toLocaleString()}</td>
                  </tr>
                );
              })}
              {allBreaches.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "var(--muted)" }}>
                    No SLA breaches for the selected window.
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

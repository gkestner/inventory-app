import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  from?: string;
  to?: string;
  hourlyRate?: string;
  mileageRate?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

async function requireReportsView() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS])) {
    redirect("/");
  }
}

function parseNum(s: string | undefined, fallback: number): number {
  const n = Number(s ?? "");
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseDateOnly(s: string | undefined): Date | null {
  const t = String(s ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function WorkOrderCostReportPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireReportsView();

  const sp = (await searchParams) ?? {};
  const from = parseDateOnly(sp.from);
  const to = parseDateOnly(sp.to);

  const hourlyRate = parseNum(sp.hourlyRate, 28);
  const mileageRate = parseNum(sp.mileageRate, 0.67);

  const where: any = {
    status: { in: ["SUBMITTED", "FINALIZED"] },
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 3000,
    select: {
      id: true,
      location: { select: { name: true } },
      createdByUser: { select: { name: true, email: true } },
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      createdAt: true,
      status: true,
    },
  });

  const byLocation = new Map<string, { hours: number; miles: number; labor: number; mileageCost: number; total: number; count: number }>();

  function hoursBetween(a: Date | null, b: Date | null): number {
    if (!a || !b) return 0;
    const ms = b.getTime() - a.getTime();
    return ms > 0 ? ms / (1000 * 60 * 60) : 0;
  }

  for (const r of rows) {
    const location = r.location?.name ?? "Unknown";
    const hrs = hoursBetween(r.startTime, r.endTime);
    const miles =
      typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
        ? Math.max(0, r.endingMileage - r.startingMileage)
        : 0;

    const labor = hrs * hourlyRate;
    const mileageCost = miles * mileageRate;
    const total = labor + mileageCost;

    const cur = byLocation.get(location) ?? { hours: 0, miles: 0, labor: 0, mileageCost: 0, total: 0, count: 0 };
    cur.hours += hrs;
    cur.miles += miles;
    cur.labor += labor;
    cur.mileageCost += mileageCost;
    cur.total += total;
    cur.count += 1;
    byLocation.set(location, cur);
  }

  const locRows = Array.from(byLocation.entries()).sort((a, b) => b[1].total - a[1].total);

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Work Order Labor + Cost Rollups</h1>
          <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
            Back to Reports
          </Link>
        </div>

        <form method="get" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <label>From<input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
            <label>To<input type="date" name="to" defaultValue={sp.to ?? ""} /></label>
            <label>Hourly Rate<input type="number" step="0.01" name="hourlyRate" defaultValue={String(hourlyRate)} /></label>
            <label>Mileage Rate<input type="number" step="0.01" name="mileageRate" defaultValue={String(mileageRate)} /></label>
          </div>
          <button type="submit" style={{ width: 180, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>Run Rollup</button>
        </form>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Location", "Orders", "Hours", "Miles", "Labor Cost", "Mileage Cost", "Total Cost"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locRows.map(([name, v]) => (
                <tr key={name}>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{name}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{v.count}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{v.hours.toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{v.miles.toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>${v.labor.toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>${v.mileageCost.toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)", fontWeight: 900 }}>${v.total.toFixed(2)}</td>
                </tr>
              ))}
              {locRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, opacity: 0.8 }}>No matching work orders.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

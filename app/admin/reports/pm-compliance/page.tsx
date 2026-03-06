import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  year?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type PmRow = {
  id: string;
  location: { name: string };
  updatedAt: Date;
  updatedByUser: { name: string | null; email: string | null } | null;
  ovenCleaning: string | null;
  exhaustFanMotor: string | null;
  tanklessWaterHeater: string | null;
  iceMaker: string | null;
  greaseTrapGallons: string | null;
  greaseTrapTankSize: string | null;
  greaseTrapDatePumped: string | null;
  greaseTrapCompany: string | null;
  greaseTrapCost: string | null;
  backflowDateChecked: string | null;
  backflowCompany: string | null;
  backflowAmount: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionCompany: string | null;
  boilerInspectionDateSecondary: string | null;
};

type Db = {
  preventativeMaintenanceEntry: {
    findMany: (args: unknown) => Promise<PmRow[]>;
  };
};

const db = prisma as unknown as Db;

const PM_FIELDS = [
  "ovenCleaning",
  "exhaustFanMotor",
  "tanklessWaterHeater",
  "iceMaker",
  "greaseTrapGallons",
  "greaseTrapTankSize",
  "greaseTrapDatePumped",
  "greaseTrapCompany",
  "greaseTrapCost",
  "backflowDateChecked",
  "backflowCompany",
  "backflowAmount",
  "boilerInspectionDatePrimary",
  "boilerInspectionCompany",
  "boilerInspectionDateSecondary",
] as const;

function parseYear(v: string | undefined): number {
  const nowYear = new Date().getFullYear();
  const n = Number(String(v ?? "").trim());
  if (!Number.isInteger(n) || n < 2020 || n > nowYear + 1) return nowYear;
  return n;
}

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE])) {
    redirect("/");
  }
}

export default async function PmComplianceReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const year = parseYear(sp.year);

  const rows = await db.preventativeMaintenanceEntry.findMany({
    where: { year },
    orderBy: { location: { name: "asc" } },
    select: {
      id: true,
      location: { select: { name: true } },
      updatedAt: true,
      updatedByUser: { select: { name: true, email: true } },
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionCompany: true,
      boilerInspectionDateSecondary: true,
    },
  });

  const entries = rows.map((r) => {
    let filled = 0;
    for (const key of PM_FIELDS) {
      const value = String(r[key] ?? "").trim();
      if (value) filled += 1;
    }
    const pct = (filled / PM_FIELDS.length) * 100;
    return {
      ...r,
      filled,
      pct,
      updatedBy:
        (r.updatedByUser?.name ?? "").trim() || (r.updatedByUser?.email ?? "").trim() || "Unknown",
    };
  });

  const byLocation = new Map<string, { count: number; sumPct: number; lowCount: number }>();
  for (const e of entries) {
    const key = e.location.name;
    const cur = byLocation.get(key) ?? { count: 0, sumPct: 0, lowCount: 0 };
    cur.count += 1;
    cur.sumPct += e.pct;
    if (e.pct < 60) cur.lowCount += 1;
    byLocation.set(key, cur);
  }

  const locationRows = Array.from(byLocation.entries())
    .map(([location, v]) => ({
      location,
      count: v.count,
      avgPct: v.count ? v.sumPct / v.count : 0,
      lowCount: v.lowCount,
    }))
    .sort((a, b) => a.avgPct - b.avgPct);

  const lowEntries = entries.filter((e) => e.pct < 60).sort((a, b) => a.pct - b.pct);

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>PM Compliance Scorecard</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Completion score estimates are based on populated PM checklist fields for each location/year row.
          </p>
        </section>

        <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            Year
            <input type="number" name="year" min={2020} max={new Date().getFullYear() + 1} defaultValue={String(year)} />
          </label>
          <button type="submit" style={{ padding: "9px 12px", borderRadius: 10, border, fontWeight: 800 }}>
            Run Report
          </button>
        </form>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Location Entries</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{entries.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Low Compliance (&lt; 60%)</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{lowEntries.length}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>By Location</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Location", "Rows", "Avg Compliance", "Low Rows"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locationRows.map((r) => (
                <tr key={r.location}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.location}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.count}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.avgPct.toFixed(1)}%</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.lowCount}</td>
                </tr>
              ))}
              {locationRows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                    No PM entries found for this year.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>Low Compliance Rows</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Location", "Completion", "Filled", "Updated", "Updated By"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lowEntries.slice(0, 200).map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: 10, borderBottom: border }}>{e.location.name}</td>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{e.pct.toFixed(1)}%</td>
                  <td style={{ padding: 10, borderBottom: border }}>{e.filled} / {PM_FIELDS.length}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{e.updatedAt.toLocaleString()}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{e.updatedBy}</td>
                </tr>
              ))}
              {lowEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 12, color: "var(--muted)" }}>
                    No low-compliance rows detected.
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

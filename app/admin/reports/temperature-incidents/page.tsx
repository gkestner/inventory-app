import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_TEMPERATURE_DASHBOARD } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  days?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type ReadingRow = {
  id: string;
  recordedAt: Date;
  alertState: "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";
  tempF: unknown;
  batteryPct: number | null;
  hub: { id: string; name: string; location: { name: string } | null };
  device: { id: string; name: string } | null;
};

type Db = {
  mocreoTemperatureReading: {
    findMany: (args: unknown) => Promise<ReadingRow[]>;
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
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD])) {
    redirect("/");
  }
}

export default async function TemperatureIncidentsReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const days = Math.min(365, parseNum(sp.days, 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.mocreoTemperatureReading.findMany({
    where: { recordedAt: { gte: since } },
    orderBy: { recordedAt: "desc" },
    take: 4000,
    select: {
      id: true,
      recordedAt: true,
      alertState: true,
      tempF: true,
      batteryPct: true,
      hub: { select: { id: true, name: true, location: { select: { name: true } } } },
      device: { select: { id: true, name: true } },
    },
  });

  const incidents = rows.filter((r) => r.alertState === "HIGH" || r.alertState === "LOW");

  const byHub = new Map<string, { hubName: string; location: string; high: number; low: number; lastAt: Date | null }>();
  for (const row of incidents) {
    const key = row.hub.id;
    const existing = byHub.get(key) ?? {
      hubName: row.hub.name,
      location: row.hub.location?.name ?? "Unknown",
      high: 0,
      low: 0,
      lastAt: null,
    };
    if (row.alertState === "HIGH") existing.high += 1;
    if (row.alertState === "LOW") existing.low += 1;
    if (!existing.lastAt || row.recordedAt > existing.lastAt) existing.lastAt = row.recordedAt;
    byHub.set(key, existing);
  }

  const hubRows = Array.from(byHub.values()).sort((a, b) => b.high + b.low - (a.high + a.low));

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Temperature Incident Timeline</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            High/low alert activity and latest incidents by Mocreo hub/device.
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

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Readings Checked</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{rows.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Incidents (HIGH/LOW)</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{incidents.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Hubs With Incidents</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{hubRows.length}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Hub", "Location", "High", "Low", "Total", "Last Incident"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hubRows.map((r) => (
                <tr key={r.hubName + r.location}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.hubName}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.location}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.high}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.low}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.high + r.low}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.lastAt ? r.lastAt.toLocaleString() : "-"}</td>
                </tr>
              ))}
              {hubRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "var(--muted)" }}>
                    No incidents in selected window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>Recent Incident Feed</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Recorded", "Hub", "Device", "State", "Temp F", "Battery %"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.slice(0, 150).map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: border }}>{r.recordedAt.toLocaleString()}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.hub.name}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.device?.name ?? "(hub)"}</td>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.alertState}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.tempF == null ? "-" : Number(r.tempF).toFixed(2)}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.batteryPct == null ? "-" : r.batteryPct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

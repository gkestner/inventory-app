import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { normalizePmYear } from "@/app/lib/preventative-maintenance";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  year?: string | string[];
};

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type AuditMetadata = {
  locationId?: string;
  locationName?: string;
  year?: number;
  source?: string;
  changes?: Record<string, { from?: string; to?: string }>;
};

type AuditRow = {
  id: string;
  action: string;
  message: string | null;
  createdAt: Date;
  actorUser: { name: string | null; email: string | null } | null;
  metadata: unknown;
};

type Db = {
  auditLog: {
    findMany: (args: unknown) => Promise<AuditRow[]>;
  };
};

const db = prisma as unknown as Db;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseAuditMetadata(v: unknown): AuditMetadata {
  if (!isRecord(v)) return {};

  const locationId = typeof v.locationId === "string" ? v.locationId : undefined;
  const locationName = typeof v.locationName === "string" ? v.locationName : undefined;
  const source = typeof v.source === "string" ? v.source : undefined;
  const year = typeof v.year === "number" && Number.isFinite(v.year) ? Math.trunc(v.year) : undefined;

  let changes: Record<string, { from?: string; to?: string }> | undefined;
  if (isRecord(v.changes)) {
    changes = {};
    for (const key of Object.keys(v.changes)) {
      const row = v.changes[key];
      if (!isRecord(row)) continue;
      changes[key] = {
        from: typeof row.from === "string" ? row.from : undefined,
        to: typeof row.to === "string" ? row.to : undefined,
      };
    }
  }

  return { locationId, locationName, year, source, changes };
}

async function requireReportsView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function PreventativeMaintenanceReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportsView();

  const resolved = (await searchParams) ?? {};
  const year = normalizePmYear(resolved.year);
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));

  const rows = await db.auditLog.findMany({
    where: {
      module: "PREVENTATIVE_MAINTENANCE",
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      action: true,
      message: true,
      createdAt: true,
      metadata: true,
      actorUser: { select: { name: true, email: true } },
    },
  });

  const byUser = new Map<string, { name: string; count: number }>();
  const byLocation = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    const userName = (row.actorUser?.name ?? "").trim() || (row.actorUser?.email ?? "").trim() || "Unknown";
    const userBucket = byUser.get(userName) ?? { name: userName, count: 0 };
    userBucket.count += 1;
    byUser.set(userName, userBucket);

    const md = parseAuditMetadata(row.metadata);
    const locName = (md.locationName ?? "").trim() || "Unknown Location";
    const locBucket = byLocation.get(locName) ?? { name: locName, count: 0 };
    locBucket.count += 1;
    byLocation.set(locName, locBucket);
  }

  const topUsers = Array.from(byUser.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const topLocations = Array.from(byLocation.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
  };

  const btn: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    textDecoration: "none",
    fontWeight: 900,
  };

  const input: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface)",
    color: "var(--foreground)",
    width: 130,
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>PM Audit & Reports</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
          Audit trail for PM updates with date/time, technician/admin actor, and changed columns.
        </p>

        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 14, fontWeight: 800 }}>
              Year
              <input name="year" type="number" min={2020} max={2100} defaultValue={year} style={{ ...input, marginLeft: 8 }} />
            </label>
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Load
            </button>
          </form>

          <Link href="/admin/preventative-maintenance" style={btn}>
            PM Matrix
          </Link>
          <Link href="/admin/reports" style={btn}>
            Reports Hub
          </Link>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Summary ({year})</h2>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Total PM Updates</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{rows.length}</div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Top Users</div>
            {topUsers.slice(0, 5).map((u) => (
              <div key={u.name} style={{ fontSize: 14 }}>
                {u.name}: <b>{u.count}</b>
              </div>
            ))}
            {topUsers.length === 0 ? <div style={{ fontSize: 14, opacity: 0.7 }}>No activity</div> : null}
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Top Locations</div>
            {topLocations.slice(0, 5).map((l) => (
              <div key={l.name} style={{ fontSize: 14 }}>
                {l.name}: <b>{l.count}</b>
              </div>
            ))}
            {topLocations.length === 0 ? <div style={{ fontSize: 14, opacity: 0.7 }}>No activity</div> : null}
          </div>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Audit Events</h2>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>Date</th>
                <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>User</th>
                <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>Location</th>
                <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>Action</th>
                <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>Changed Columns</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const md = parseAuditMetadata(row.metadata);
                const changed = Object.keys(md.changes ?? {});
                const userName = (row.actorUser?.name ?? "").trim() || (row.actorUser?.email ?? "").trim() || "Unknown";
                return (
                  <tr key={row.id}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{fmtDateTime(row.createdAt)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{userName}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{md.locationName ?? "Unknown"}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{row.action}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                      {changed.length > 0 ? changed.join(", ") : "(no field changes)"}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 14, opacity: 0.75 }}>
                    No PM audit rows for {year}.
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

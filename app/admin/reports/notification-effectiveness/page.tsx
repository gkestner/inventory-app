import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  days?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

function parseNum(v: string | undefined, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60));
}

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    redirect("/");
  }
}

export default async function NotificationEffectivenessReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const days = Math.min(365, parseNum(sp.days, 30));
  const exportHref = `/api/admin/reports/notification-effectiveness/export?days=${encodeURIComponent(String(days))}`;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.notification.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 6000,
    select: {
      id: true,
      type: true,
      title: true,
      createdAt: true,
      readAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  const byType = new Map<string, { total: number; read: number; sumReadMinutes: number; readCount: number }>();

  for (const row of rows) {
    const key = String(row.type);
    const b = byType.get(key) ?? { total: 0, read: 0, sumReadMinutes: 0, readCount: 0 };
    b.total += 1;
    if (row.readAt) {
      b.read += 1;
      b.sumReadMinutes += minutesBetween(row.createdAt, row.readAt);
      b.readCount += 1;
    }
    byType.set(key, b);
  }

  const typeRows = Array.from(byType.entries())
    .map(([type, v]) => ({
      type,
      total: v.total,
      read: v.read,
      unread: v.total - v.read,
      readRate: v.total ? (v.read / v.total) * 100 : 0,
      avgReadMinutes: v.readCount ? v.sumReadMinutes / v.readCount : null,
    }))
    .sort((a, b) => b.total - a.total);

  const byUser = new Map<string, { user: string; total: number; unread: number }>();
  for (const row of rows) {
    const userName = (row.user.name ?? "").trim() || row.user.email || "Unknown";
    const b = byUser.get(row.user.id) ?? { user: userName, total: 0, unread: 0 };
    b.total += 1;
    if (!row.readAt) b.unread += 1;
    byUser.set(row.user.id, b);
  }

  const userRows = Array.from(byUser.values()).sort((a, b) => b.unread - a.unread || b.total - a.total);
  const staleUnread = rows.filter((r) => !r.readAt && minutesBetween(r.createdAt, new Date()) > 24 * 60);

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Notification Effectiveness</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
            <Link href={exportHref} style={{ textDecoration: "none", fontWeight: 800 }}>
              Export CSV
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Read rates and time-to-read trends across notification types and users.
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

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Notifications</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{rows.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Stale Unread (&gt;24h)</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{staleUnread.length}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>By Notification Type</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Type", "Total", "Read", "Unread", "Read Rate", "Avg Minutes To Read"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {typeRows.map((r) => (
                <tr key={r.type}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.type}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.total}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.read}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.unread}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.readRate.toFixed(1)}%</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.avgReadMinutes == null ? "-" : r.avgReadMinutes.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>Users With Most Unread</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["User", "Unread", "Total"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {userRows.slice(0, 100).map((r) => (
                <tr key={r.user}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{r.user}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.unread}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

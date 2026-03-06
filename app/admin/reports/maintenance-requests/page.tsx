import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { computeAverageResolutionHours } from "@/app/lib/maintenance-requests";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type Db = {
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        status: "OPEN" | "RESOLVED" | "ARCHIVED";
        createdAt: Date;
        resolvedAt: Date | null;
        archivedAt: Date | null;
        title: string;
        location: { id: string; name: string };
        assignedMaintenanceUser: { id: string; name: string | null; email: string | null } | null;
      }>
    >;
  };
  auditLog: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        action: string;
        message: string | null;
        createdAt: Date;
        entityId: string | null;
        actorUser: { name: string | null; email: string | null } | null;
      }>
    >;
  };
};

const db = prisma as unknown as Db;

async function requireReportsView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function personLabel(person: { name: string | null; email: string | null } | null | undefined): string {
  if (!person) return "Unassigned";
  return String(person.name ?? "").trim() || String(person.email ?? "").trim() || "Unknown";
}

function fmtDateTime(value: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default async function MaintenanceRequestReportsPage() {
  await requireReportsView();

  const [rows, auditRows] = await Promise.all([
    db.maintenanceRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        archivedAt: true,
        title: true,
        location: { select: { id: true, name: true } },
        assignedMaintenanceUser: { select: { id: true, name: true, email: true } },
      },
    }),
    db.auditLog.findMany({
      where: { module: "MAINTENANCE_REQUESTS" },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        entityId: true,
        actorUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const total = rows.length;
  const open = rows.filter((r) => r.status === "OPEN").length;
  const resolved = rows.filter((r) => r.status === "RESOLVED").length;
  const archived = rows.filter((r) => r.status === "ARCHIVED").length;

  const avgResolutionHours = computeAverageResolutionHours(rows.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt })));

  const byLocation = Array.from(
    rows.reduce((acc, row) => {
      const key = row.location.name;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const byTech = Array.from(
    rows.reduce((acc, row) => {
      const key = personLabel(row.assignedMaintenanceUser);
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  return (
    <main>
      <div style={{ maxWidth: 1260, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 18 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Maintenance Request Reports</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"<- Reports Hub"}
            </Link>
            <Link href="/admin/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Queue ->"}
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
            Audit and trend reporting for maintenance requests, assignment load, and closeout pace.
          </p>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Total Requests</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{total}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Open</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{open}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Resolved</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{resolved}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Archived</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{archived}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Avg Resolution (hours)</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{avgResolutionHours === null ? "-" : avgResolutionHours.toFixed(1)}</div>
          </article>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
            <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>By Location</h2>
            {byLocation.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No data.</div>
            ) : (
              byLocation.slice(0, 20).map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </article>

          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
            <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>By Assigned Technician</h2>
            {byTech.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No data.</div>
            ) : (
              byTech.slice(0, 20).map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </article>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>Recent Request Audit Activity</h2>
          {auditRows.length === 0 ? (
            <div style={{ padding: 12, opacity: 0.8 }}>No maintenance request audit rows yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <th style={{ textAlign: "left", padding: 10 }}>When</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Actor</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Action</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Message</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Request ID</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontSize: 13 }}>{fmtDateTime(row.createdAt)}</td>
                      <td style={{ padding: 10 }}>{personLabel(row.actorUser)}</td>
                      <td style={{ padding: 10, fontWeight: 800 }}>{row.action}</td>
                      <td style={{ padding: 10 }}>{row.message ?? "-"}</td>
                      <td style={{ padding: 10, fontFamily: "monospace", fontSize: 12 }}>{row.entityId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
